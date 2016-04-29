"use strict";

let EventEmitter = require("events").EventEmitter,
	Express = require("express"),
	WebSocket = require("ws"),
	Catan = require("./catan"),
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
	lobby = [];

	let board = new Catan();
	let turn = 0;
	let currentState;

	let players = clients.map((ws) => new Player());

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
			currentState.onmessage(ws, player, message);
		});

		ws.on("close", function (code, message) {
			console.log("player %d left", player);
			close.emit("close", player);
		});
	});

				sendError(ws, "turn");
				return;
			}
			
			// Handling robber mode
			if (handlingRobber) {
				switch (message.message) {
				default:
					sendError(ws, "message");
					break;
				
				case "discardResources":
					let discardCount = 0;
					
					for (let resourceType in message.resources) {
						discardCount += message.resources[resourceType];
					}
					
					if (!players[player].hasResources(message.resources) || discardCount != resourcesToDiscard[player]) {
						sendError(ws, "discardResources");
						break;
					}
					resourcesToDiscard[player] = 0;
					players[player].spendResources(message.resources);
					
					ws.send(JSON.stringify({ message: "discardGood" }));
					sendResources(ws, players[player]);
					break;
				
				case "moveRobber":
					if (robberMoved || !board.tiles[message.y] || !board.tiles[message.y][message.x]) {
						sendError(ws, "moveRobber");
						break;
					}
					
					let terrain = board.tiles[message.y][message.x];
					if (terrain !== Catan.OCEAN) {
						robberMoved = true;
						board.robber[0] = message.x;
						board.robber[1] = message.y;
						
						let targets = [];
						for (let [vx, vy, vd] of board.cornerVertices(message.x, message.y)) {
							
							let building = board.buildings[vy][vx][vd];							
							if (building && building.player !== player) {
								let resourceSum = 0;
								let playerResources = players[building.player].resources;
								for (let resourceType in playerResources) {
									resourceSum += playerResources[resourceType];
								}
								if (resourceSum > 0) {
									console.log("adding target: " + building.player);
									targets.push(building.player);
								}
							}
						}
						
						
						let stealingPlayer = player;
						clients.forEach(function (ws, player) {
							if (player === stealingPlayer) {
								ws.send(JSON.stringify({
									message: "robberGood", 
									x: message.x, 
									y: message.y,
									targets: targets
								}));
							}
							ws.send(JSON.stringify({
								message: "robberGood", 
								x: message.x, 
								y: message.y,
							}));
						});
						
						// If there is no one to steal from, assume stealing has already been completed.
						if (targets.length == 0) {
							resourceStolen = true;
						}
						
					} else {
						sendError(ws, "moveRobber");
					}
					
					break;
					
				case "steal":
					if (resourceStolen) {
						sendError(ws, "steal");
						break;
					}
					
					let allResources = [];
					let playerResources = players[message.player].resources;
					for (let resourceType in playerResources) {
						for (let i = 0; i < playerResources[resourceType]; i++) {
							allResources.push(resourceType);
						}
					}
					// Choose a random resource to steal
					let chosenIndex = Math.floor(Math.random() * allResources.length);
					let chosenResource = allResources[chosenIndex];
					players[player].resources[chosenResource]++;
					players[message.player].resources[chosenResource]--;
					// Update resource counts
					sendResources(ws, players[player]);
					sendResources(clients[message.player], players[message.player]);
					resourceStolen = true;
				}
				
				// Check if we're done with "robber mode"
				let toDiscard = 0;
				for (let player in resourcesToDiscard) {
					toDiscard += resourcesToDiscard[player]
				}
				// TODO: re-add discard check
				if (toDiscard == 0 && robberMoved && resourceStolen) {
					handlingRobber = false;
				}
				
	class Play {
		onmessage(ws, player, message) {
			if (player != turn) {
				sendError(ws, "turn");
				return;
			}

			switch (message.message) {
			default: sendError(ws, "message"); break;

			case "offer":
				let tradeState = new Trade();
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

				players[turn].build(message.type);
				sendResources(clients[turn], players[turn]);
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({
						message: "build", type: message.type,
						x: message.x, y: message.y, d: message.d,
						player: turn
					}));
				});
				break;

			case "turn":
				turn = (turn + 1) % clients.length;

				let dice = rollDie() + rollDie();

				// assign resources
				for (let [tx, ty] of board.hit[dice]) {
					let terrain = board.tiles[ty][tx];
					for (let [vx, vy, vd] of board.cornerVertices(tx, ty)) {
						// If robber in space, don't assign resources
						if (board.robber[0] == vx && board.robber[1] == vy) {
							continue;
						}
						let building = board.buildings[vy][vx][vd];
						if (building) {
							let amount;
							if (building.type == Catan.TOWN) {
								amount = 1;
							} else if (building.type == Catan.CITY) {
								amount = 2;
							}
							players[building.player].resources[terrain] += amount;
						}
					}
				}

				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({ message: "turn", player: turn, dice: dice, start: message.start }));
					sendResources(ws, players[player]);
				});

				if (dice == 7) {
					currentState = new Robber();
				}
				break;
			}
		}
	}

	class Trade {
		constructor() {
			this.offers = [];
		}

		onmessage(ws, player, message) {
			if (player != turn && message.message != "offer") {
				sendError(ws, "confirm");
				return false;
			}

			switch (message.message) {
			default: sendError(ws, "message"); break;

			case "offer":
				if (countResources(offer) == 0 || !players[offeringPlayer].hasResources(offer)) {
					sendError(ws, "offer");
					return false;
				}

				this.offers[offeringPlayer] = offer;
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({
						message: "offer", offer: offer, player: offeringPlayer
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
					ws.send(JSON.stringify({ message: "end" }));
				});

				currentState = new Play();
				break;

			case "cancel":
				clients.forEach(function (ws, player) {
					ws.send(JSON.stringify({ message: "end" }));
				});

				currentState = new Play();
				break;
			}

			return true;
		}
	}

	class Robber {
		constructor() {
			this.robberMoved = false;
			this.resourceStolen = false;
			this.resourcesToDiscard = [];

			for (let player in players) {
				if (countResources(players[player].resources) > 7) {
					this.resourcesToDiscard[player] = Math.floor(resourceSum / 2);
				}
			}
		}

		onmessage(ws, player, message) {
			if (player != turn && message.message != "discardResources") {
				sendError(ws, "confirm");
				return false;
			}

			switch (message.message) {
			default: sendError(ws, "message"); break;

			case "discardResources":
				let discardCount = countResources(message.resources);
				if (
					!players[player].hasResources(message.resources) ||
					discardCount != this.resourcesToDiscard[player]
				) {
					sendError(ws, "discardResources");
					break;
				}

				this.resourcesToDiscard[player] = 0;
				players[player].spendResources(message.resources);

				ws.send(JSON.stringify({ message: "discardGood" }));
				sendResources(ws, players[player]);
				break;

			case "moveRobber":
				if (
					this.robberMoved ||
					!board.tiles[message.y] || !board.tiles[message.y][message.x] ||
					board.tiles[message.y][message.x] == Catan.OCEAN
				) {
					sendError(ws, "moveRobber");
					break;
				}

				this.robberMoved = true;
				board.robber = [message.x, message.y];

				let targets = [];
				for (let [vx, vy, vd] of board.cornerVertices(message.x, message.y)) {
					let building = board.buildings[vy][vx][vd];
					if (!building || building.player == turn) { continue; }

					if (resourceSum > countResources(players[building.player].resources)) {
						console.log("adding target: " + building.player);
						targets.push(building.player);
					}
				}

				// If there is no one to steal from, assume stealing has already been completed.
				if (targets.length == 0) {
					this.resourceStolen = true;
				}

				let stealingPlayer = player;
				clients.forEach(function (ws, player) {
					let robberGood = { message: "robberGood", x: message.x, y: message.y };
					if (player == stealingPlayer) { robberGood.targets = targets; }

					ws.send(JSON.stringify(message));
				});
				break;

			case "steal":
				if (this.resourceStolen) {
					sendError(ws, "steal");
					break;
				}

				let allResources = [];
				let playerResources = players[message.player].resources;
				for (let resourceType in playerResources) {
					allResources.push.apply(allResources, repeat(resourceType, playerResources[resourceType]));
				}

				// Choose a random resource to steal
				let chosenIndex = Math.floor(Math.random() * allResources.length);
				let chosenResource = allResources[chosenIndex];
				players[player].resources[chosenResource]++;
				players[message.player].resources[chosenResource]--;

				// Update resource counts
				sendResources(ws, players[player]);
				sendResources(clients[message.player], players[message.player]);

				this.resourceStolen = true;
				break;
			}

			// Check if we're done with "robber mode"
			let toDiscard = this.resourcesToDiscard.reduce((x, y) => x + y);
			// TODO: re-add discard check
			if (toDiscard == 0 && this.robberMoved && this.resourceStolen) {
				currentState = new Play();
			}

			return;
		}
	}

	currentState = new Play();

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

function countResources(hand) {
	let sum = 0;
	for (let resourceType in hand) {
		sum += hand[resourceType];
	}
	return sum;
}

function rollDie() {
	return Math.floor(Math.random() * 6 + 1);
}
