const Datastore = require('nedb-promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

const users = Datastore.create({ filename: path.join(dataDir, 'users.db'), autoload: true });
const games = Datastore.create({ filename: path.join(dataDir, 'games.db'), autoload: true });

users.ensureIndex({ fieldName: 'username', unique: true });
games.ensureIndex({ fieldName: 'white_id' });
games.ensureIndex({ fieldName: 'black_id' });

module.exports = { users, games };
