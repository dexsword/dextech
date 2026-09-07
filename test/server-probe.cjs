// Report the real listener address over IPC without exporting production internals.
const net = require('node:net');
const path = require('node:path');
const originalListen = net.Server.prototype.listen;

net.Server.prototype.listen = function(...args) {
  this.once('listening', () => {
    if (process.send) process.send(this.address());
  });
  return originalListen.apply(this, args);
};

require(path.join(process.cwd(), 'server.js'));
