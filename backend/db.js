const sqlite3 = require('sqlite3').verbose();
const path = require('path');

function initDb(){
	return new Promise((resolve, reject) => {
		const dbPath = path.resolve(__dirname, 'app.db');
		const db = new sqlite3.Database(dbPath, (err) => {
			if(err) return reject(err);

			// simple promisified wrapper matching the minimal API expected by server.js
			const wrapper = {
				run(sql, params = []){
					return new Promise((res, rej) => {
						db.run(sql, params, function(err){
							if(err) return rej(err);
							res({ lastID: this.lastID, changes: this.changes });
						});
					});
				},
				get(sql, params = []){
					return new Promise((res, rej) => {
						db.get(sql, params, (err, row) => {
							if(err) return rej(err);
							res(row);
						});
					});
				},
				all(sql, params = []){
					return new Promise((res, rej) => {
						db.all(sql, params, (err, rows) => {
							if(err) return rej(err);
							res(rows);
						});
					});
				},
				close(){
					return new Promise((res, rej) => db.close(err => err ? rej(err) : res()));
				}
			};

			// Create minimal schema used by the server
			const schema = `
				PRAGMA foreign_keys = ON;
				CREATE TABLE IF NOT EXISTS users (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					name TEXT,
					email TEXT UNIQUE,
					password_hash TEXT,
					is_admin INTEGER DEFAULT 0,
					created_at DATETIME DEFAULT CURRENT_TIMESTAMP
				);
				CREATE TABLE IF NOT EXISTS doctors (
					id TEXT PRIMARY KEY,
					name TEXT,
					specialty TEXT,
					hospital TEXT,
					languages TEXT,
					experience_years INTEGER,
					rating REAL,
					next_available TEXT,
					education TEXT,
					bio TEXT,
					location TEXT,
					conditions TEXT
				);
				CREATE TABLE IF NOT EXISTS bookings (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					user_id INTEGER,
					doctor_id TEXT,
					date TEXT,
					time TEXT,
					reason TEXT,
					created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
					FOREIGN KEY(user_id) REFERENCES users(id)
				);
			`;

			// Execute schema statements serially
			db.exec(schema, (err) => {
				if(err) return reject(err);
				resolve(wrapper);
			});
		});
	});
}

module.exports = { initDb };
