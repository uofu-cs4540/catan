"use strict";

let Catan = require("../catan").Catan,
	Player = require("../player");

	let radius = 35,
			hexagon_narrow_width = 3 / 2 * radius,
			hexagon_height = 2 * radius * Math.sin(Math.PI / 3);

	let tileToPixels = function (x, y) {
		let width = canvas.width;
		let height = canvas.height;
		let xx = x - 3, yy = y - 3;
		return [
			width / 4 + hexagon_narrow_width * xx,
			height / 2 - hexagon_height * (xx / 2 + yy)
		];
	};

	let vertexToPixels = function (x, y, d) {
		let [px, py] = tileToPixels(x, y);
		if (d == 0) { px -= radius; }
		else if (d == 1) { px += radius; }
		return [px, py];
	};

	let pixelsToTile = function (px, py) {
		let width = canvas.width;
		let height = canvas.height;

		// convert to fractional cube coordinates
		let x = (px - width / 4) / hexagon_narrow_width,
			y = (height / 2 - py) / hexagon_height - x / 2,
			z = -(x + y);

		// round to nearest cube and calculate the difference
		let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
		let dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);

		// whichever coordinate moved farthest, push it back into the hex grid plane
		if (dx > dy && dx > dz) {
			rx = -(ry + rz);
		} else if (dy > dz) {
			ry = -(rx + rz);
		} else {
			rz = -(rx + ry);
		}

		return [rx + 3, ry + 3];
	};

	let pixelsToVertex = function (px, py) {
		let [x, y] = pixelsToTile(px, py);
		let [cx, cy] = tileToPixels(x, y);
		let angle = Math.atan2(cy - py, px - cx);
		let hextant = (Math.floor((angle + Math.PI / 6) / 2 / Math.PI * 6) + 6) % 6;

		switch (hextant) {
		case 0: return [x, y, 1];
		case 1: return [x + 1, y, 0];
		case 2: return [x - 1, y + 1, 1];
		case 3: return [x, y, 0];
		case 4: return [x - 1, y, 1];
		case 5: return [x + 1, y - 1, 0];
		}
	};

	let pixelsToEdge = function (px, py) {
		let [x, y] = pixelsToTile(px, py);
		let [cx, cy] = tileToPixels(x, y);
		let angle = Math.atan2(cy - py, px - cx);
		let hextant = (Math.floor(angle / 2 / Math.PI * 6) + 6) % 6;

		switch (hextant) {
		case 0: return [x, y, 2];
		case 1: return [x, y, 1];
		case 2: return [x, y, 0];
		case 3: return [x - 1, y, 2];
		case 4: return [x, y - 1, 1];
		case 5: return [x + 1, y - 1, 0];
		}
	};

let currentState;
let run = function (state) {
	currentState = state;
	(function update(time) {
		requestAnimationFrame(update);
		currentState.draw();
	})(performance.now());
};

const tileColors = ["#f4a460", "#666666", "#003200", "#006400", "#ffff00", "#660000", "#0000ff"];
const playerColors = ["#ff0000", "#ffffff", "#0000ff", "#00ff00"];

const server = "ws://" + window.location.hostname + ":8081";

class ResourceSprite {
	constructor(sx, sy, fx, fy, resource, assets, ctx){

		switch(resource){
			case Catan.ORE:		this.image = assets.ore_sm; break;
			case Catan.WOOD:	this.image = assets.logs_sm; break;
			case Catan.WOOL:	this.image = assets.wool_sm; break;
			case Catan.GRAIN:	this.image = assets.grain_sm; break;
			case Catan.BRICK: this.image = assets.bricks_sm; break;
		}
		this.ctx = ctx;
		this.x = sx; this.fx = fx;
		this.y = sy; this.fy = fy;
		this.speed = 1;
		this.scale = 0.5;
		this.drawCount = 0;
	}

	draw() {
		let ctx = this.ctx, width = ctx.canvas.clientWidth, height = ctx.canvas.clientHeight;
		this.drawCount++;

		ctx.drawImage(this.image, this.x - this.image.width * this.scale / 2, this.y - this.image.height * this.scale / 2, 
									this.image.width * this.scale, this.image.height * this.scale);

		let N = 125;
		if(this.drawCount < N){
			this.scale = 0.5 + (this.drawCount/N * 0.5);
			return; // Grow to full size but stay still within first N draw calls
		}

		if(this.x > this.fx)
			this.x -= this.speed;
		else if(this.x < this.fx)
			this.x += this.speed;

		if(this.y > this.fy)
			this.y -= this.speed;
		else if(this.y < this.fy)
			this.y += this.speed;
	}

	isDone() { return Math.abs(this.x - this.fx) <= 1 && Math.abs(this.y - this.fy) <= 1; }
}

class Lobby {
	constructor(ctx) {
		this.ctx = ctx;

		this.assets = {
			hexagon: new Image(), hexagons: [],
			town: new Image(), city: new Image(), towns: [], cities: [],
			pawn: new Image(),
			ore_sm: new Image(),
			logs_sm: new Image(),
			grain_sm: new Image(),
			wool_sm: new Image(),
			bricks_sm: new Image(),
		};
		this.assets.hexagon.addEventListener("load", () => {
			tileColors.forEach((color, i) => {
				this.assets.hexagons[i] = blend(this.assets.hexagon, color);
			});
		});
		this.assets.town.addEventListener("load", () => {
			playerColors.forEach((color, i) => {
				this.assets.towns[i] = blend(this.assets.town, color);
			});
		});
		this.assets.city.addEventListener("load", () => {
			playerColors.forEach((color, i) => {
				this.assets.cities[i] = blend(this.assets.city, color);
			});
		});

		function blend(image, color) {
			let blendCanvas = document.createElement("canvas");
			let blendCtx = blendCanvas.getContext("2d");

			blendCanvas.width = image.width;
			blendCanvas.height = image.height;

			blendCtx.fillStyle = color;
			blendCtx.fillRect(0, 0, blendCanvas.width, blendCanvas.height);

			blendCtx.globalCompositeOperation = "multiply";
			blendCtx.drawImage(image, 0, 0);

			blendCtx.globalCompositeOperation = "destination-atop";
			blendCtx.drawImage(image, 0, 0);

			return blendCanvas;
		}

		for (let asset in this.assets) {
			this.assets[asset].src = "assets/" + asset + ".png";
		}

		this.ws = new WebSocket(server);
		this.ws.onmessage = (event) => {
			console.log(event.data);

			let message = JSON.parse(event.data);
			switch (message.message) {
			case "start":
				this.board = new Catan(message.board);
				this.player = message.player;
				break;

			case "turn":
				this.turn = message.player;
				currentState = new Play(
					this.ctx, this.assets, this.ws,
					this.board, this.player, this.turn
				);
				break;

			case "end":
				currentState = new Lobby(ctx);
				break;
			}
		};
	}

	draw() {
		let ctx = this.ctx, width = ctx.canvas.clientWidth, height = ctx.canvas.clientHeight;

		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, width, height);

		ctx.font = "48px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#fff";
		ctx.fillText("Waiting for players...", width / 2, height / 2);
	}
}

class Play {
	constructor(ctx, assets, ws, board, player, turn) {
		this.ctx = ctx;
		this.assets = assets;
		this.ws = ws;

		this.board = board;
		this.hand = new Player();
		this.player = player;
		this.turn = turn;

		this.pregame = true;
		this.lastTown = [];

		this.sprites = [];

		this.tradingOffers = [];
		this.tradingOngoing = false;

		this.mouseX = 0;
		this.mouseY = 0;

		this.ws.onmessage = (event) => {
			console.log(event.data);

			let message = JSON.parse(event.data);
			switch (message.message) {
			// main play messages

			case "turn":
				this.turn = message.player;
				this.dice = message.dice;				
				if (message.start) {
					this.pregame = false;
					delete this.lastTown;
				}

				if (!this.dice) { break; }
				if (this.dice == 7 && this.player == message.player) {
					this.action = "moveRobber";
				}

				for (let [hx, hy] of this.board.hit[this.dice]) {
					let resource = this.board.tiles[hy][hx];
					let [tpx, tpy] = tileToPixels(hx, hy);
					for (let [cx, cy, cd] of this.board.cornerVertices(hx, hy)) {
						if (!this.board.buildings[cy][cx][cd]) { continue; }

						let [vpx, vpy] = vertexToPixels(cx, cy, cd);
						this.sprites.push(new ResourceSprite(
							tpx, tpy, vpx, vpy, resource, this.assets, this.ctx
						));
					}
				}
				break;

			case "resources":
				this.hand.resources = message.resources;
				this.hand.pieces = message.pieces;
				this.hand.cards = message.cards;
				break;

			case "build":
				if (this.pregame && message.type == Catan.TOWN) {
					this.lastTown[message.player] = { x: message.x, y: message.y, d: message.d };
				}

				if (this.pendingCity) { delete this.pendingCity; }
				this.board.build(
					message.type, message.x, message.y, message.d, message.player,
					this.pregame, this.lastTown[message.player]
				);
				break;

			// trading messages

			case "offer":
				this.tradingOngoing = true;
				this.tradingOffers[message.player] = message.offer;
				break;

			case "end":
				currentState = new Lobby(ctx);
				break;

			// robber messages

			case "stealGood":
				let total = 0;
				for (let resource in Play.resourceNames) {
					resource = +resource;
					total += this.hand.resources[resource];
				}

				if (total > 7) {
					// Find number to discard
					let discard = Math.floor(total/2);

					// Update label
					let cards = (discard > 1)? "Cards": "Card";
					document.getElementById("discard-amount").innerHTML = "Discard " + discard + " " + cards;
					showDiscardModal();
				}

				break;

			case "discardGood":
				document.getElementById('discard-modal').style.display = "none";
				break;

			case "error":
				if (message.error == "discardResources") {
					showDiscardModal();
				}
				break;

			case "robberGood":
				this.board.robber = [message.x, message.y];
				if (this.action == "moveRobber") {
					delete currentState.action;
				}
				if (message.targets && message.targets.length > 0) {
					this.action = "stealing";

					// Add UI element to select player with event to send steal message
					for (let i=0; i < message.targets.length; i++) {
						let target = message.targets[i];
						let button = document.createElement("button");
						button.innerHTML = "Steal From Player " + target;
						button.setAttribute("type", "button");
						button.classList.add("steal-btn");
						button.addEventListener("click", function (event) {
							this.ws.send(JSON.stringify({ message: "steal", player:target }));
							let removals = document.querySelectorAll(".steal-btn");
							for (let j=0; j < removals.length; j++) {
								document.forms.building.removeChild(removals[j]);
							}
							if (this.action == "stealing") {
								delete this.action;
							}

							event.preventDefault();
						}.bind(this));
						document.forms.building.appendChild(button);
					}
				}
				break;
			}
		};
	}

	draw() {
		let ctx = this.ctx, width = ctx.canvas.clientWidth, height = ctx.canvas.clientHeight;

		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, width, height);

		ctx.font = "14px sans-serif";
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillStyle = "#fff";
		ctx.fillText("You are player " + this.player + " and it is player " + this.turn + "'s turn", 0, 0);

		let [mx, my] = pixelsToTile(this.mouseX, this.mouseY);
		ctx.fillText("Mouse cursor on tile (" + mx + "," + my + ")", 0, 16);

		let [mvx, mvy, mvd] = pixelsToVertex(this.mouseX, this.mouseY);
		ctx.fillText("Mouse cursor near vertex (" + mvx + "," + mvy + "," + ["L", "R"][mvd] + ")", 0, 32);

		let [mex, mey, med] = pixelsToEdge(this.mouseX, this.mouseY);
		ctx.fillText("Mouse cursor near edge (" + mex + "," + mey + "," + ["W", "N", "E"][med] + ")", 0, 48);

		// draw tiles, roads, and buildings
		let cx = 3, cy = 3, N = 3;

		// draw tiles
		this.board.forEachTile(cx, cy, N, (x, y) => {
			let [px, py] = tileToPixels(x, y);

			let image = this.assets.hexagons[this.board.tiles[y][x]] || this.assets.hexagon;
			let width = radius * 2 - 5, height = radius * 2 - 10;
			ctx.drawImage(image, px - width / 2, py - height / 2, width, height);
		});

		// draw roads
		this.board.forEachTile(cx, cy, N, (x, y) => {
			for (let d = 0; d < 3; d++) {
				let road = this.board.roads[y][x][d];
				if (road == null) { continue; }

				let [[x1, y1, d1], [x2, y2, d2]] = this.board.endpointVertices(x, y, d);
				let [px1, py1] = vertexToPixels(x1, y1, d1);
				let [px2, py2] = vertexToPixels(x2, y2, d2);

				ctx.strokeStyle = playerColors[road];
				ctx.lineWidth = 4;
				ctx.beginPath();
				ctx.moveTo(px1, py1);
				ctx.lineTo(px2, py2);
				ctx.stroke();
			}
		});

		// draw "under construction" items
		{
			let drawGhost = (validityCheck, x, y, d) => {
				if (validityCheck(x, y, d, currentState.player, this.pregame)) {
					let [px, py] = vertexToPixels(x, y, d);
					ctx.globalAlpha = 0.5;
					let image = (currentState.action == "buildTown")? this.assets.towns[currentState.player]: this.assets.cities[currentState.player];
					ctx.drawImage(image, px - image.width / 2, py - image.height / 2);
					ctx.globalAlpha = 1.0;
				}
			};

			if (currentState.action == "buildTown") {
				drawGhost(currentState.board.validTown.bind(currentState.board), mvx, mvy, mvd);
			}

			if (currentState.action == "buildCity") {
				drawGhost(currentState.board.validCity.bind(currentState.board), mvx, mvy, mvd);
			}

			if (currentState.action == "buildRoad") {
				let lastTown = this.pregame ? this.lastTown[this.player] : undefined;
				if (currentState.board.validRoad(
					mex, mey, med, currentState.player, this.pregame, lastTown)
				) {
					let [[x1, y1, d1], [x2, y2, d2]] = this.board.endpointVertices(mex, mey, med);
					let [px1, py1] = vertexToPixels(x1, y1, d1);
					let [px2, py2] = vertexToPixels(x2, y2, d2);

					ctx.strokeStyle = playerColors[currentState.player]; ctx.lineWidth = 4;
					ctx.globalAlpha = 0.5;
					ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
					ctx.globalAlpha = 1.0;
				}
			}
		}

		// draw buildings
		this.board.forEachTile(cx, cy, N, (x, y) => {
			for (let d = 0; d < 2; d++) {
				let building = this.board.buildings[y][x][d];
				let pending = currentState.pendingCity;

				/* Don't display the building if:
					1) There is not building at this tile
					2) A city is being placed
					3) A city is being confirmed by the server
				*/
				if (
					!building ||
					(this.action == "buildCity" && x == mvx && y == mvy && d == mvd) ||
					(pending && pending.x == x && pending.y == y && pending.d == d)
				) { continue; }

				let [px, py] = vertexToPixels(x, y, d);
				let image;
				if (building.type == Catan.TOWN) {
					image = this.assets.towns[building.player];
				} else if (building.type == Catan.CITY) {
					image = this.assets.cities[building.player];
				}
				ctx.drawImage(image, px - image.width / 2, py - image.height / 2);
			}
		});

		// Store vertex and edge coordinates in current state (should decouple from rendering?)
		currentState.lvx = mvx; currentState.lvy = mvy; currentState.lvd = mvd;
		currentState.lex = mex; currentState.ley = mey; currentState.led = med;
		currentState.lmx = mx; currentState.lmy = my;

		// draw numbers
		this.board.hit.forEach((hit, i) => {
			if (hit == null || i == 0) { return; }

			ctx.font = "16px sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillStyle = "0xfff";
			for (let [x, y] of hit) {
				let [px, py] = tileToPixels(x, y);

				ctx.fillText(i, px, py - 10);
				ctx.fillText(getPips(i), px, py+ 10);
			}

			function getPips(i) {
				switch (i) {
				case 2: case 12: return "•";
				case 3: case 11: return "••";
				case 4: case 10: return "•••";
				case 5: case 9: return "••••";
				case 6: case 8: return "•••••";
				}
			}
		});

		// draw robber
		if (this.action == "moveRobber") {
			let image = this.assets.pawn;
			let [px, py] = tileToPixels(mx, my);
			if (currentState.board.tiles[my] && currentState.board.tiles[my][mx] && currentState.board.tiles[my][mx] != Catan.OCEAN) {
				ctx.globalAlpha = 0.5;
				ctx.drawImage(image, px - image.width / 2, py - image.height / 2);
				ctx.globalAlpha = 1.0;
			}
		} else {
			let image = this.assets.pawn;
			let [px, py] = tileToPixels(this.board.robber[0], this.board.robber[1]);
			ctx.drawImage(image, px - image.width / 2, py - image.height / 2);
		}

		// draw hand
		{
			ctx.font = "14px sans-serif";
			ctx.textAlign = "left";
			ctx.textBaseline = "top";
			ctx.fillStyle = "#fff";

			for (let piece in this.hand.pieces) {
				let y = piece * 16;
				ctx.fillText(Play.pieceNames[piece], width / 2 + 0, y);
				ctx.fillText(this.hand.pieces[piece], width / 2 + 50, y);
			}

			for (let resource in this.hand.resources) {
				let y = -16 + resource * 16;
				ctx.fillText(Play.resourceNames[resource], width / 2 + 100, y);
				ctx.fillText(this.hand.resources[resource], width / 2 + 150, y);
			}

			for (let card in this.hand.cards) {
				let y = card * 16;
				ctx.fillText(Play.cardNames[card], width / 2 + 200, y);
				ctx.fillText(this.hand.cards[card], width / 2 + 320, y);
			}
		}

		if (this.tradingOngoing) {
			ctx.font = "14px sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillStyle = "0xfff";

			let j = 0;
			for (let i = 0; i < 4; i++) {
				let tx, ty;
				if (i == this.turn) {
					tx = width * 3 / 4;
					ty = 200;
				} else {
					tx = width * (7 + 2 * j) / 12;
					ty = 300;
					j++;
				}

				ctx.fillText("Player " + i + " Offers:", tx, ty);
				let offerText = [];
				let offer = this.tradingOffers[i];
				for (let resourceType in offer) {
					if (offer[resourceType] > 0) {
						offerText.push(offer[resourceType].toString() + " " + Play.resourceNames[resourceType]);
					}
				}
				ctx.fillText(offerText.join(", "), tx, ty + 16);
			}
		}

		for(let i=this.sprites.length-1; i>=0; i--){
			this.sprites[i].draw();
			if(this.sprites[i].isDone()){
				delete this.sprites[i];
				this.sprites.splice(i, 1);
			}
		}

	}

	moveRobber(x, y) {
		this.ws.send(JSON.stringify({ message: "moveRobber", x: x, y: y }));
	}

	build(type, x, y, d) {
		this.ws.send(JSON.stringify({ message: "build", type: type, x: x, y: y, d: d }));
	}

	offer(offer) {
		this.ws.send(JSON.stringify({ message: "offer", offer: offer }));
	}

	confirm(player) {
		this.ws.send(JSON.stringify({ message: "confirm", player: player }));
	}

	cancel() {
		this.ws.send(JSON.stringify({ message: "cancel" }));
	}

	endTurn() {
		this.ws.send(JSON.stringify({ message: "turn" }));
	}
}

Play.resourceNames = {
	[Catan.ORE]: "ore",
	[Catan.WOOD]: "wood",
	[Catan.WOOL]: "wool",
	[Catan.GRAIN]: "grain",
	[Catan.BRICK]: "brick",
};

Play.pieceNames = {
	[Catan.ROAD]: "roads",
	[Catan.TOWN]: "towns",
	[Catan.CITY]: "cities",
};

Play.cardNames = {
	[Catan.KNIGHT]: "knights",
	[Catan.YEAR_OF_PLENTY]: "year of plenty",
	[Catan.MONOPOLY]: "monopoly",
	[Catan.VICTORY_POINT]: "victory points",
	[Catan.ROAD_BUILDING]: "road building",
};

let canvas = document.createElement("canvas");
canvas.width = 1050;
canvas.height = 525;
document.body.appendChild(canvas);

let restoreDefaultButtons = function () {
	document.getElementById("buildRoad").innerHTML = "Build Road";
	document.getElementById("buildTown").innerHTML = "Build Town";
	document.getElementById("buildCity").innerHTML = "Build City";
}

canvas.addEventListener("mousemove", function (event) {
	let rect = canvas.getBoundingClientRect();
	currentState.mouseX = event.clientX - rect.left;
	currentState.mouseY = event.clientY - rect.top;
});

canvas.addEventListener("click", function (event) {
	event.preventDefault();
	if (!currentState.action) { return; }

	switch(currentState.action) {
		case "buildTown": currentState.build(Catan.TOWN, currentState.lvx, currentState.lvy, currentState.lvd); break;
		case "buildRoad": currentState.build(Catan.ROAD, currentState.lex, currentState.ley, currentState.led); break;
		case "buildCity": currentState.build(Catan.CITY, currentState.lvx, currentState.lvy, currentState.lvd); break;
		case "moveRobber": currentState.moveRobber(currentState.lmx, currentState.lmy); break;
		default: return;
	}

	// Save pending city so the town does not blink into place before the server confirms the city is valid
	if (currentState.action == "buildCity") {
		currentState.pendingCity = {x:currentState.lvx, y:currentState.lvy, d:currentState.lvd};
	}

	if (currentState.action != "moveRobber") {
		delete currentState.action;
	}
	restoreDefaultButtons();	
});

["buildRoad", "buildTown", "buildCity"].forEach(function (id) {
	document.getElementById(id).addEventListener("click", function (event) {
		event.preventDefault();
		if (currentState.action == "moveRobber" || currentState.action == "stealing") {
			return;
		}
		restoreDefaultButtons();
		if (currentState.action == id) {
			delete currentState.action;
		} else {
			currentState.action = id;
			document.getElementById(id).innerHTML = "Cancel";
		}		
	});
});

document.getElementById("endTurn").addEventListener("click", function (event) {
	event.preventDefault();
	if (currentState.action == "moveRobber" || currentState.action == "stealing") {
		return;
	}

	if (currentState.action) {
		delete currentState.action;
		restoreDefaultButtons();
	}
	currentState.endTurn();	
});

{
	let form = document.forms.trading;

	form.offer.addEventListener("click", function (event) {
		currentState.offer({
			[Catan.ORE]: +form.ore.value,
			[Catan.WOOD]: +form.wood.value,
			[Catan.WOOL]: +form.wool.value,
			[Catan.GRAIN]: +form.grain.value,
			[Catan.BRICK]: +form.brick.value,
		});
		event.preventDefault();
	});

	form.cancel.addEventListener("click", function (event) {
		currentState.cancel();
		event.preventDefault();
	});

	[
		form.accept0, form.accept1, form.accept2, form.accept3
	].forEach(function (button, i) {
		button.addEventListener("click", function (event) {
			currentState.confirm(i);
			event.preventDefault();
		});
	});
}

let ctx = canvas.getContext("2d");
let lobby = new Lobby(ctx);

document.getElementById("discard-btn").addEventListener("click", function (event) {
	event.preventDefault();
	let total = 0;
	for (let resource in Play.resourceNames) {
		resource = +resource;
		total += +document.getElementById(Play.resourceNames[resource]).innerHTML;						
	}
	let discard = Math.floor(total/2);

	// Check if total is good
	let discarded = +document.forms.discard.ore.value +
									+document.forms.discard.wood.value +
									+document.forms.discard.wool.value +
									+document.forms.discard.grain.value +
									+document.forms.discard.brick.value;

	document.forms.discard

	if (discarded == discard) {
		let resources = {
			[Catan.ORE]: +document.forms.discard.ore.value,
			[Catan.WOOD]: +document.forms.discard.wood.value,
			[Catan.WOOL]: +document.forms.discard.wool.value,
			[Catan.GRAIN]: +document.forms.discard.grain.value,
			[Catan.BRICK]: +document.forms.discard.brick.value,
		};

		this.ws.send(JSON.stringify({ message: "discardResources", resources:resources }));		
	} else {
		alert("No! bad!");
	}
}.bind(lobby));

let showDiscardModal = function () {
	document.forms.discard.ore.max = currentState.hand.resources[Catan.ORE];
	document.forms.discard.wood.max = currentState.hand.resources[Catan.WOOD];
	document.forms.discard.wool.max = currentState.hand.resources[Catan.WOOL];
	document.forms.discard.grain.max = currentState.hand.resources[Catan.GRAIN];
	document.forms.discard.brick.max = currentState.hand.resources[Catan.BRICK];
	document.getElementById('discard-modal').style.display = "block";
}

let discardForm = document.forms.discard;
let discards = [discardForm.ore, discardForm.wood, discardForm.wool, discardForm.grain, discardForm.brick];
discards.forEach(function (input) {
	input.addEventListener("change", function (event) {
		if (+event.target.value > +event.target.max) {
			event.target.value = +event.target.max;
		}
	});
});

run(lobby);
