"use strict";

class Catan {
	constructor(board) {
		// if we're deserializing a board, just read the data and stop
		if (board) {
			Object.assign(this, board);
			return;
		}

		// create board structure
		this.tiles = [];
		this.buildings = [];
		this.roads = [];

		// First player to surpass this gets the Longest Road points
		this.maxRoadLength = 1;
		this.maxRoadPlayer = null;

		// First player to surpass this gets the Largest army points
		this.maxSoldiers = 2;
		this.maxSoldiersPlayer = null;

		for (let y = 0; y < 7; y++) {
			this.tiles[y] = repeat(null, 7);
			this.buildings[y] = [];
			this.roads[y] = [];

			for (let x = 0; x < 7; x++) {
				this.buildings[y][x] = repeat(null, 2);
				this.roads[y][x] = repeat(null, 3);
			}
		}

		this.hit = [];
		// No tiles are hit if we roll a 7
		this.hit[7] = [];

		const cx = 3, cy = 3, N = 2;
		const directions = [[0, 1], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1]];

		// randomize the game
		let tilePool = shuffle(TILE_POOL.slice());
		let chitPool = rotate(CHIT_POOL.slice(), Math.random() * CHIT_POOL.length);
		let addTile = (x, y) => {
			let terrain = tilePool.pop();
			this.tiles[y][x] = terrain;

			let chit = terrain == Catan.NONE ? 0 : chitPool.pop();
			if (!this.hit[chit]) { this.hit[chit] = []; }
			this.hit[chit].push([x, y]);

			if (terrain == Catan.NONE) { this.robber = [x, y]; }
		}

		// add ground tiles
		addTile(cx, cy);
		for (let radius = 1; radius <= N; radius++) {
			ring(cx, cy, radius, addTile);
		}

		// add ocean tiles
		ring(cx, cy, N + 1, (x, y) => {
			this.tiles[y][x] = Catan.OCEAN;
		});

		function ring(cx, cy, radius, callback) {
			let tx = cx + directions[4][0] * radius, ty = cy + directions[4][1] * radius;
			for (let side = 0; side < 6; side++) {
				let [dx, dy] = directions[side];
				for (let tile = 0; tile < radius; tile++) {
					callback(tx, ty);
					tx += dx;
					ty += dy;
				}
			}
		}
	}

	build(type, x, y, d, player, pregame, adjacent) {
		return {
			[Catan.ROAD]: this.buildRoad,
			[Catan.TOWN]: this.buildTown,
			[Catan.CITY]: this.buildCity,
		}[type].apply(this, [x, y, d, player, pregame, adjacent]);
	}

	validRoad(x, y, d, player, pregame, town) {
		// a road must be placed on an existing, empty edge
		if (!this.roads[y] || !this.roads[y][x]) { return false; }
		if (this.roads[y][x][d] != null) { return false; }

		// a road must touch land
		if (!this.joiningTiles(x, y, d).some(([tx, ty]) => this.isGround(tx, ty))) { return false; }

		// a road must be next to a road or town of the same player
		// during pregame, a road must be next to the player's last town (given by `town`)
		for (let [ex, ey, ed] of this.endpointVertices(x, y, d)) {
			if (!this.buildings[ey] || !this.buildings[ey][ex]) { continue; }
			if (this.buildings[ey][ex][ed] && this.buildings[ey][ex][ed].player == player) {
				if (!pregame) { return true; }
				else if (town && ex == town.x && ey == town.y && ed == town.d) { return true; }
			} else if (!pregame) {
				for (let [px, py, pd] of this.protrudeEdges(ex, ey, ed)) {
					if (!this.roads[py] || !this.roads[py][px]) { continue; }
					if (this.roads[py][px][pd] == player) { return true; }
				}
			}
		}

		return false;
	}

	// an edge is specified as a tile and either west, north, or east (0/1/2)
	buildRoad(x, y, d, player, pregame, adjacent) {
		if (!this.validRoad(x, y, d, player, pregame, adjacent)) { return false; }
		this.roads[y][x][d] = player;
		return true;
	}

	validTown(x, y, d, player, pregame) {
		if (!this.buildings[y] || !this.buildings[y][x]) { return false; }

		// Ensure that this vertex touches at least one land tile
		if (!this.touchesTiles(x, y, d).some(([tx, ty]) => this.isGround(tx, ty))) { return false; }

		// A town must be placed on an empty vertex not adjacent to any other towns
		if (this.buildings[y][x][d] != null) { return false; }
		for (let [ax, ay, ad] of this.adjacentVertices(x, y, d)) {
			if(!this.buildings[ay] || !this.buildings[ay][ax])
				continue;
			if (this.buildings[ay][ax][ad] != null) { return false; }
		}

		// Once the pregame state ends, a town must touch a road belonging to current player
		if (!pregame) {
			let touches = false;
			for(let [ex, ey, ed] of this.protrudeEdges(x, y, d)){
				if(this.roads[ey][ex][ed] == player)
					touches = true;
			}
			if (!touches) { return false; }
		}

		return true;
	}

	// a vertex is specified as a tile and either left or right (0/1)
	buildTown(x, y, d, player, pregame) {
		if (!this.validTown(x, y, d, player, pregame)) { return false; }
		this.buildings[y][x][d] = { player: player, type: Catan.TOWN };
		return true;
	}

	validCity(x, y, d, player) {
		// a city must be placed on top of a vertex that contains a town of the same player
		if (!this.buildings[y] || !this.buildings[y][x] || !this.buildings[y][x][d]) {
			return false;
		}

		let building = this.buildings[y][x][d];
		if (building.player != player || building.type != Catan.TOWN) { return false; }
		return true;
	}

	buildCity(x, y, d, player) {
		if (!this.validCity(x, y, d, player)) { return false; }
		this.buildings[y][x][d] = { player: player, type: Catan.CITY };
		return true;
	}

	isGround(x, y) {
		return (
			this.tiles[y] && this.tiles[y][x] != null &&
			this.tiles[y][x] != Catan.OCEAN
		);
	}

	robberTargets(x, y, exclude) {
		let targets = [];
		for (let [vx, vy, vd] of this.cornerVertices(x, y)) {
			let building = this.buildings[vy][vx][vd];
			if (!building || building.player == exclude || targets.indexOf(building.player) > -1) {
				continue;
			}

			targets.push(building.player);
		}
		return targets;
	}

	forEachTile(cx, cy, N, callback) {
		for (let dx = -N; dx <= N; dx++) {
			for (let dy = Math.max(-N, -dx - N); dy <= Math.min(N, -dx + N); dy++) {
				let x = cx + dx, y = cy + dy;
				callback(x, y);
			}
		}
	}

	// corner vertices of a tile
	cornerVertices(x, y) {
		return [
			[x, y, 1], [x + 1, y, 0], [x - 1, y + 1, 1],
			[x, y, 0], [x - 1, y, 1], [x + 1, y - 1, 0],
		];
	}

	// joining tiles of an edge
	joiningTiles(x, y, d) {
		if (d == 0) { return [[x, y], [x - 1, y + 1]]; }
		else if (d == 1) { return [[x, y + 1], [x, y]]; }
		else if (d == 2) { return [[x + 1, y], [x, y]]; }
	}

	// endpoint vertices of an edge
	endpointVertices(x, y, d) {
		if (d == 0) { return [[x - 1, y + 1, 1], [x, y, 0]]; }
		else if (d == 1) { return [[x + 1, y, 0], [x - 1, y + 1, 1]]; }
		else if (d == 2) { return [[x, y, 1], [x + 1, y, 0]]; }
	}

	// touching tiles of a vertex
	touchesTiles(x, y, d) {
		if (d == 0) { return [[x, y], [x-1, y], [x-1, y+1]]; }
		else if (d == 1) { return [[x+1, y], [x+1, y-1], [x,y]]; }
	}

	// protruding edges from a vertex
	protrudeEdges(x, y, d) {
		if (d == 0) { return [[x, y, 0], [x - 1, y, 2], [x - 1, y, 1]]; }
		else if (d == 1) { return [[x + 1, y - 1, 1], [x + 1, y - 1, 0], [x, y, 2]]; }
	}

	// adjacent vertices of a vertex
	adjacentVertices(x, y, d) {
		if (d == 0) { return [[x - 1, y + 1, 1], [x - 1, y, 1], [x - 2, y + 1, 1]]; }
		else if (d == 1) { return [[x + 2, y - 1, 0], [x + 1, y - 1, 0], [x + 1, y, 0]]; }
	}
};

// building types
Catan.ROAD = 0;
Catan.TOWN = 1;
Catan.CITY = 2;
Catan.CARD = 3;

// resource and tile types
Catan.NONE = 0;
Catan.ORE = 1;
Catan.WOOD = 2;
Catan.WOOL = 3;
Catan.GRAIN = 4;
Catan.BRICK = 5;
Catan.OCEAN = 6;

Catan.resourceNames = {
	[Catan.ORE]: "ore",
	[Catan.WOOD]: "wood",
	[Catan.WOOL]: "wool",
	[Catan.GRAIN]: "grain",
	[Catan.BRICK]: "brick",
};

// development cards
Catan.KNIGHT = 0;
Catan.YEAR_OF_PLENTY = 1;
Catan.MONOPOLY = 2;
Catan.VICTORY_POINT = 3;
Catan.ROAD_BUILDING = 4;

const TILE_POOL = Array.prototype.concat(
	repeat(Catan.NONE, 1),
	repeat(Catan.ORE, 3),
	repeat(Catan.BRICK, 3),
	repeat(Catan.WOOD, 4),
	repeat(Catan.GRAIN, 4),
	repeat(Catan.WOOL, 4)
);

const CHIT_POOL = [ 5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11 ];

function repeat(element, times) {
	let array = [];
	for (let i = 0; i < times; i++) {
		array.push(element);
	}
	return array;
}

// via http://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
function shuffle(array) {
	for (let i = array.length; i > 0; i--) {
		let j = Math.floor(Math.random() * i);
		let tmp = array[i - 1];
		array[i - 1] = array[j];
		array[j] = tmp;
	}
	return array;
}

function rotate(array, count) {
	array.unshift.apply(array, array.splice(count));
	return array;
}

module.exports.Catan = Catan;
module.exports.repeat = repeat;
module.exports.shuffle = shuffle;
