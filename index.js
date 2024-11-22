const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const { SerialPort } = require('serialport');
const fetch = require('node-fetch');
require("dotenv").config();

const app = express();
const port = 3000;
const server = createServer(app);
const wss = new WebSocket.Server({ server });

let savedToken = null;

const serialPort = new SerialPort({
  path: '/dev/cu.usbmodem1101',
  baudRate: 115200,
});

serialPort.on('error', function (err) {
  console.log('Error: ', err.message);
});

serialPort.on('data', function (data) {
  const dataString = data.toString();
  console.log("Arduino -> Quest | " + dataString);

  wss.clients.forEach(function (client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(dataString);
    }
  });
});

async function getToken() {
  try {
    const response = await fetch(`${process.env.REST_API_URL}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        'password' : process.env.PASSWORD
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    savedToken = data.token;
    return savedToken;
  } catch (error) {
    console.error('Error while fetching token:', error.message);
  }
}

async function getPatient() {
  const patientID = 8001011234567;
  try {
    const url = `${process.env.REST_API_URL}/patient/${patientID}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${savedToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Patient data received:', data);
  } catch (error) {
    console.error('Error while fetching patient data:', error.message);
  }
}

getToken().then(token => {
  getPatient();
  if (token) {
    console.log('Received token:', token);
  } else {
    console.log('Failed to obtain token');
  }
});

wss.on('connection', function (ws) {
  console.log("Client joined.");

  ws.on('message', async function (message) {
    console.log('Received message:', message);

    const patientID = message;

    if (patientID) {
      if (savedToken) {
        try {
          const url = `https://port-0-autopalp-server-m3qr5oi138cff77f.sel4.cloudtype.app/patient/${patientID}`;

          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${savedToken}`,
              'Accept': 'application/json'
            }
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();
          console.log('Patient data received:', data);
          
          ws.send(JSON.stringify(data));
        } catch (error) {
          console.error('Error while fetching patient data:', error.message);
        }
      } else {
        console.error('Token is not available!');
      }
    } else {
      serialPort.write(message, function (err) {
        if (err) {
          return console.log('Error on write: ', err.message);
        }
        console.log("Quest -> Arduino | " + message);
      });
    }
  });

  ws.on('close', function () {
    console.log("Client left.");
  });
});

server.listen(port, function () {
  console.log(`Listening on http://localhost:${port}`);
});