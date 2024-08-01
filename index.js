const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const { SerialPort } = require('serialport');

const app = express();
const port = 3000;

const server = createServer(app);
const wss = new WebSocket.Server({ server });

const serialPort = new SerialPort({
  path: '/dev/cu.usbmodem21201', // Replace with your actual serial port path
  baudRate: 115200,
});

serialPort.on('error', function (err) {
  console.log('Error: ', err.message);
});

serialPort.on('data', function (data) {
  const dataString = data.toString();
  console.log("Arduino -> Quest | '" + dataString + "' from Arduino");

  // Broadcast data to all connected clients
  wss.clients.forEach(function (client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(dataString);
    }
  });
});

wss.on('connection', function (ws) {
  console.log("Client joined.");

  ws.on('message', function (message) {
      serialPort.write(message, function (err) {
        if (err) {
          return console.log('Error on write: ', err.message);
        }
        console.log("Quest -> Arduino | " + message + " to Arduino");
      });
  });

  ws.on('close', function () {
    console.log("Client left.");
  });
});

server.listen(port, function () {
  console.log(`Listening on http://localhost:${port}`);
});
