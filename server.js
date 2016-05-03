"use strict";

let EventEmitter = require("events").EventEmitter,
	Express = require("express"),
	WebSocket = require("ws"),
	catan = require("./catan"), Catan = catan.Catan, repeat = catan.repeat, shuffle = catan.shuffle,
	Player = require("./player");

let app = Express();
app.use(Express.static("public"));
app.listen(8080);

let wss = new WebSocket.Server({ port: 8081 });

let lobby = [];
wss.on("connection", function (ws) {
	// add a new player to the lobby; remove them if they disconnect before game start
	console.log("player joined lobby");

	ws.on("close", function (code, message) {
		console.log("player left lobby");
		lobby.splice(lobby.indexOf(ws), 1);
	});

	lobby.push(ws);
	if (lobby.length < 4) {
		return;
	}

	// when the lobby has 4 players, spin off a game
	console.log("starting new game");

	let clients = lobby;
	let players = clients.map((ws) => new Player());
	lobby = [];

	let board = new Catan();
	let turn = 0;
	let currentState;

	let close = new EventEmitter();
	close.once("close", function (skip) {
		clients.forEach(function (ws, player) {
			if (player == skip) { return; }

			ws.send(JSON.stringify({ message: "end" }));
			ws.close();
		});
	});

	clients.forEach(function (ws, player) {
		ws.removeAllListeners("close");

		ws.on("message", function (messageJson) {
			console.log("received from player %d: %s", player, messageJson);

			let message = JSON.parse(messageJson);
			if (message.message == "chat") {
				let sendingPlayer = player;
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({
						message: "chat",
						text: message.text.substring(0,1000), sender: sendingPlayer
					}));
				});
				return;
			}

			currentState.onmessage(ws, player, message);
		});

		ws.on("close", function (code, message) {
			console.log("player %d left", player);
			close.emit("close", player);
		});
	});

	class Start {
		constructor() {
			this.towns = [];
			this.building = 0;
			this.phase = 0;

			turn = this.start = [
				rollDie() + rollDie(),
				rollDie() + rollDie(),
				rollDie() + rollDie(),
				rollDie() + rollDie(),
			].reduce((max, d, i, v) => d > v[max] ? i : max, 0);

			clients.forEach(function (ws, player) {
				ws.send(JSON.stringify({ message: "start", board: board, player: player }));
				ws.send(JSON.stringify({ message: "turn", player: turn }));
			});
		}

		onmessage(ws, player, message) {
			if (player != turn) {
				sendError(ws, "turn");
				return;
			}

			switch (message.message) {
			default: sendError(ws, "message"); break;


			case "build":
				// player needs to build town, then road next to that town
				if (
					message.type != [Catan.TOWN, Catan.ROAD][this.building] ||
					!board.build(
						message.type, message.x, message.y, message.d, turn,
						true, this.towns[turn]
					)
				) {
					sendError(ws, "build");
					break;
				}

				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({
						message: "build", type: message.type,
						x: message.x, y: message.y, d: message.d,
						player: turn
					}));
				});

				// save town and switch to next building type
				if (this.building == 0) {
					this.towns[turn] = { x: message.x, y: message.y, d: message.d };
				}
				this.building = (this.building + 1) % 2;
				if (this.building == 1) { break; }

				let nextTurn;
				if (this.phase == 0) {
					// move one player up or go to next phase
					nextTurn = (turn + 1) % clients.length;
					if (nextTurn == this.start) {
						this.phase += 1;
						break;
					}
				} else if (this.phase == 1) {
					// move one player down or start main game
					nextTurn = (turn + clients.length - 1) % clients.length;
					if (turn == this.start) {
						turn = nextTurn;
						currentState = new Play();
						currentState.onmessage(ws, turn, { message: "turn" }, true);
						break;
					}
				}
				turn = nextTurn;

				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({ message: "turn", player: turn }));
				});
				break;
			}
		}
	}

	class Play {

		constructor() {
			// each player gets one resource for each town touching a tile
			board.forEachTile(3, 3, 2, (x, y) => {
				for (let [vx, vy, vd] of board.cornerVertices(x, y)) {
					let building = board.buildings[vy][vx][vd];
					if (!building) { continue; }

					let tile = board.tiles[y][x];
					players[building.player].resources[tile] += 1;
				}
			});

			this.development = repeat(Catan.KNIGHT, 14);
			this.development.push.apply(this.development, repeat(Catan.VICTORY_POINT, 5));
			this.development.push.apply(this.development, repeat(Catan.ROAD_BUILDING, 2));
			this.development.push.apply(this.development, repeat(Catan.MONOPOLY, 2));
			this.development.push.apply(this.development, repeat(Catan.YEAR_OF_PLENTY, 2));

			shuffle(this.development);

			this.longestRoad = 4;
			this.longestRoadOwner = -1;

			this.largestArmy = 2;
			this.largestArmyOwner = -1;

			this.pendingCards = [];
			this.devCardPlayed = false;

			this.freeRoads = 0;

			clients.forEach(function (ws, player) {
				sendResources(ws, players[player]);
			});
		}

		onmessage(ws, player, message, start) {
			if (player != turn) {
				sendError(ws, "turn");
				return;
			}

			switch (message.message) {
			default: sendError(ws, "message"); break;

			case "offer":
				let tradeState = new Trade(this);
				if (tradeState.onmessage(ws, player, message)) {
					currentState = tradeState;
				}
				break;

			case "build":
				if (
					!players[turn].canAfford(message.type) ||
					!board.build(message.type, message.x, message.y, message.d, turn)
				) {
					sendError(ws, "build");
					break;
				}

				if (message.type == Catan.ROAD && this.freeRoads > 0) {
					this.freeRoads--;
				} else {
					players[turn].build(message.type);
				}

				if (message.type == Catan.ROAD) {
					this.dfs({ x: +message.x, y: +message.y, d: +message.d }, turn);
				}

				sendResources(clients[turn], players[turn]);
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({
						message: "build", type: message.type,
						x: message.x, y: message.y, d: message.d,
						player: turn
					}));
				});
				break;

			case "buyDevelop":
				if(!players[player].canAfford(Catan.CARD) || this.development.length == 0){
					sendError(ws, "buyDevelop");
					break;
				}
				this.pendingCards.push(this.development.pop());
				players[player].build(Catan.CARD);
				sendResources(ws, players[player]);
				break;

			case "turn":
				turn = (turn + 1) % clients.length;
				this.freeRoads = 0;

				let dice = rollDie() + rollDie();
				for (let [tx, ty] of board.hit[dice]) {
					let terrain = board.tiles[ty][tx];
					for (let [vx, vy, vd] of board.cornerVertices(tx, ty)) {
						// the robber blocks its tile from producing resources
						let [rx, ry] = board.robber;
						if (rx == vx && ry == vy) { continue; }

						let building = board.buildings[vy][vx][vd];
						if (!building) { continue; }

						let amount;
						if (building.type == Catan.TOWN) {
							amount = 1;
						} else if (building.type == Catan.CITY) {
							amount = 2;
						}
						players[building.player].resources[terrain] += amount;
					}
				}
				for(let card of this.pendingCards){
					players[player].cards[card]++;	
				}
				this.pendingCards = [];
				this.devCardPlayed = false;

				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({
						message: "turn", player: turn, dice: dice, start: start
					}));
					sendResources(ws, players[player]);
				});

				if (dice == 7) {
					// players with more than 7 cards must discard half
					let resourcesToDiscard = [];
					for (let player in players) {
						let resourceCount = Player.countResources(players[player].resources);
						if (resourceCount > 7) {
							resourcesToDiscard[player] = Math.floor(resourceCount / 2);
						}
					}

					currentState = new Robber(this, resourcesToDiscard);
				}
				break;

			case "develop":
				if(players[player].cards[message.card] < 1 || this.devCardPlayed){
					sendError(ws, "develop");
					return;
				}

				this.devCardPlayed = true;
				//Only one card may be played per turn.
				switch(message.card){
					case Catan.KNIGHT:
						currentState = new Robber(this, repeat(0,4));
						players[player].knights++;
						break;

					case Catan.YEAR_OF_PLENTY:
						//Give the resources the player has chose to the player
						for(let terrain of message.resources){
							if(terrain > 5 || terrain < 1) {
								sendError(ws, "yopResourceType")
								continue;
							}
							players[player].resources[terrain] += 1;
						}
						//Remove the card from the hand. 
						players[player].cards[Catan.YEAR_OF_PLENTY]--; 

						//Inform the player
						sendResources(ws, players[player]);						
						break;
					case Catan.MONOPOLY:
						//For every other-player, remove their selected resources and give them to the card-player
						for(let player_iter = 0; player_iter < 4; player_iter++){
							if(player_iter != player){
								let resource_count = players[player_iter].resources[message.terrain];
								players[player_iter].resources[message.terrain] -= resource_count;
								players[player].resources[message.terrain] += resource_count;
							}
						}
						clients.forEach(function (ws, player) {
							sendResources(ws, players[player]);
						});						
						break;
					case Catan.ROAD_BUILDING:
						this.freeRoads = 2;
						break;
					default: //Unknown development card or Victory Points
						this.devCardPlayed = false;
						sendError(ws, "develop");
						break;	
				}
				break;
			}
		}

		// road contains x,y,d coordinates
		dfs(road, player) {
			let buildVisited = function () {
				let visited = [];
				for (let y = 0; y < 7; y++) {
					visited[y] = [];
					for (let x = 0; x < 7; x++) {
						visited[y][x] = [];
						visited[y][x].push({ visited: false, endNode: false });
						visited[y][x].push({ visited: false, endNode: false });
						visited[y][x].push({ visited: false, endNode: false });
					}
				}
				return visited;
			};

			let visited = buildVisited();
			this.dfs_r(road, visited, player);

			// Now visited contains markers for end nodes
			for (let y = 0; y < 7; y++) {
				for (let x = 0; x < 7; x++) {
					for (let d = 0; d < 3; d++) {
						if (visited[y][x][d].endNode) {
							let visited_cost = buildVisited();
							let max = this.dfs_cost({ x: x, y: y, d: d }, 0, 0, player, visited_cost);
							if (max > board.maxRoadLength) {
								board.maxRoadLength = max;
								board.maxRoadPlayer = player;

								console.log("max road length: " + max);
								console.log("max road player: " + player);
							}
						}
					}
				}
			}
		}

		dfs_cost(road, depth, max, player, visited_cost) {
			depth++;
			visited_cost[road.y][road.x][road.d].visited = true;
			let neighbors = this.road_neighbors(road, player);
			neighbors.forEach(neighbor => {				
				if (depth > max) {
					max = depth;
				}

				if(!visited_cost[neighbor.y][neighbor.x][neighbor.d].visited) { 
					max = this.dfs_cost(neighbor, depth, max, player, visited_cost);
				}
			});
			return max;
		}

		road_neighbors(road, player) {
			let neighbors = [];
			let endpoints = board.endpointVertices(road.x, road.y, road.d);
			endpoints.forEach(endpoint => {
				let candidates = board.protrudeEdges(endpoint[0], endpoint[1], endpoint[2]);
				candidates.forEach(candidate => {
					let cx = candidate[0];
					let cy = candidate[1];
					let cd = candidate[2];

					if ((cx != road.x || cy != road.y || cd != road.d) && player == board.roads[cy][cx][cd]) { 
						neighbors.push({x:cx, y:cy,d :cd});
					}
				});
			});

			return neighbors;
		}

		dfs_r(road, visited, player) { 
			visited[road.y][road.x][road.d].visited = true;
			visited[road.y][road.x][road.d].endNode = true;

			var neighbors = this.road_neighbors(road, player);
			neighbors.forEach(neighbor => {		
				let cx = neighbor.x;
				let cy = neighbor.y;
				let cd = neighbor.d;
				if(!visited[cy][cx][cd].visited) { 
					visited[road.y][road.x][road.d].endNode = false;
					this.dfs_r(neighbor, visited, player);
				}
			});
		}
	}

	class Trade {
		constructor(play) {
			this.play = play;
			this.offers = [];
		}

		onmessage(ws, player, message) {
			if (player != turn && message.message != "offer") {
				sendError(ws, "turn");
				return false;
			}

			switch (message.message) {
			default: sendError(ws, "message"); break;

			case "offer":
				if (
					Player.countResources(message.offer) == 0 ||
					!players[player].hasResources(message.offer)
				) {
					sendError(ws, "offer");
					return false;
				}

				this.offers[player] = message.offer;
				let offeringPlayer = player;
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({
						message: "offer", offer: message.offer, player: offeringPlayer
					}));
				});
				break;

			case "confirm":
				for (let resourceType in this.offers[player]) {
					players[turn].resources[resourceType] += (
						this.offers[message.player][resourceType] - this.offers[turn][resourceType]
					);
					players[message.player].resources[resourceType] += (
						this.offers[turn][resourceType] - this.offers[message.player][resourceType]
					);
				}

				sendResources(clients[turn], players[turn]);
				sendResources(clients[message.player], players[message.player]);
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({ message: "confirm" }));
				});

				currentState = this.play;
				break;

			case "cancel":
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({ message: "confirm" }));
				});

				currentState = this.play;
				break;
			}

			return true;
		}
	}

	class Robber {
		constructor(play, resourcesToDiscard) {
			this.play = play;
			this.resourcesToDiscard = resourcesToDiscard;
		}

		onmessage(ws, player, message) {
			if (player != turn && message.message != "discard") {
				sendError(ws, "confirm");
				return false;
			}

			let toDiscard = this.resourcesToDiscard.reduce((x, y) => x + y, 0);

			switch (message.message) {
			default: sendError(ws, "message"); break;

			case "discard":
				if (
					Player.countResources(message.resources) != this.resourcesToDiscard[player] ||
					!players[player].hasResources(message.resources)
				) {
					sendError(ws, "discard");
					break;
				}

				this.resourcesToDiscard[player] = 0;
				players[player].spendResources(message.resources);

				ws.send(JSON.stringify({ message: "discard" }));
				sendResources(ws, players[player]);
				break;

			case "robber":
				// the robber must be moved after all discards have been made,
				// as well as to a ground tile
				if (
					toDiscard > 0 ||
					!board.tiles[message.y] || board.tiles[message.y][message.x] == null ||
					board.tiles[message.y][message.x] == Catan.OCEAN
				) {
					sendError(ws, "robber");
					break;
				}

				currentState = this.play;

				// if the robber is moved to a tile neighboring any other players,
				// the player moving the robber must pick one of them to steal from
				let targets = board.robberTargets(message.x, message.y, turn);
				if (targets.length > 0 && targets.indexOf(message.player) == -1) {
					sendError(ws, "robber");
					break;
				}

				board.robber = [message.x, message.y];
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({ message: "robber", x: message.x, y: message.y }));
				});

				if (targets.length == 0) { break; }

				let playerResources = players[message.player].resources;
				let resources = Array.prototype.concat.apply([], Object.keys(playerResources).map(
					(type) => repeat(type, playerResources[type])
				));
				if (resources.length == 0) { break; }

				let resource = resources[Math.floor(Math.random() * resources.length)];
				players[player].resources[resource] += 1;
				players[message.player].resources[resource] -= 1;

				sendResources(ws, players[player]);
				sendResources(clients[message.player], players[message.player]);
				break;
			}

			return;
		}
	}

	if (false) {
		board.build(Catan.TOWN, 3, 3, 0, 0, true);
		board.build(Catan.ROAD, 3, 3, 0, 0, true, { x: 3, y: 3, d: 0 });
		board.build(Catan.TOWN, 3, 2, 1, 0, true);
		board.build(Catan.ROAD, 4, 1, 1, 0, true, { x: 3, y: 2, d: 1 });
		board.build(Catan.TOWN, 3, 5, 1, 1, true);
		board.build(Catan.ROAD, 4, 4, 0, 1, true, { x: 3, y: 5, d: 1 });
		board.build(Catan.TOWN, 2, 3, 0, 1, true);
		board.build(Catan.ROAD, 1, 3, 2, 1, true, { x: 2, y: 3, d: 0 });
		board.build(Catan.TOWN, 5, 3, 0, 2, true);
		board.build(Catan.ROAD, 4, 3, 2, 2, true, { x: 5, y: 3, d: 0 });
		board.build(Catan.TOWN, 1, 5, 1, 2, true);
		board.build(Catan.ROAD, 2, 4, 0, 2, true, { x: 1, y: 5, d: 1 });
		board.build(Catan.TOWN, 2, 2, 1, 3, true);
		board.build(Catan.ROAD, 3, 1, 0, 3, true, { x: 2, y: 2, d: 1 });
		board.build(Catan.TOWN, 1, 2, 1, 3, true);
		board.build(Catan.ROAD, 1, 2, 2, 3, true, { x: 1, y: 2, d: 1 });

		clients.forEach(function (ws, player) {
			ws.send(JSON.stringify({ message: "start", board: board, player: player }));
			ws.send(JSON.stringify({ message: "turn", player: turn }));
		});

		let ws = clients[turn];
		turn = (turn + clients.length - 1) % clients.length;

		currentState = new Play();
		currentState.onmessage(ws, turn, { message: "turn" }, true);
	} else {
		currentState = new Start();
	}

	function sendResources(ws, player) {
		ws.send(JSON.stringify({
			message: "resources",
			resources: player.resources,
			pieces: player.pieces,
			cards: player.cards,
		}));
	}

	function sendError(ws, message) {
		ws.send(JSON.stringify({ message: "error", error: message }));
	}
});

function rollDie() {
	return Math.floor(Math.random() * 6 + 1);
}
