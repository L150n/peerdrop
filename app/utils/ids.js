const { nanoid } = require('nanoid');

function generateId(length = 12) {
  return nanoid(length);
}

module.exports = { generateId };
