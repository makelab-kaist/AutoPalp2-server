const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const { SerialPort } = require('serialport');
const fetch = require('node-fetch');
require("dotenv").config();

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

let savedToken = null;
let currRegions = 0;
const palpationData = generatePalpationData();

// Initialize SerialPort
const serialPort = new SerialPort({
  path: process.env.SERIAL_PORT_PATH || '/dev/cu.usbmodem1101',
  baudRate: 115200,
});

serialPort.on('error', (err) => console.error('SerialPort Error:', err.message));

serialPort.on('data', (data) => {
  const dataString = data.toString();
  console.log("Arduino -> Quest |", dataString);

  broadcastToClients(dataString);

  try {
    const parsedData = JSON.parse(dataString);

    if (parsedData.ack === "ready") {
      console.log("Arduino is ready."); 
    } else if (parsedData.ack === "reset") {
      console.log("Reset Arduino."); 
    } else if (parsedData.data) {
      const number = parseInt(parsedData.data, 10);
      if (!isNaN(number)) {
        updateForceValue(number);
        console.log("Updated force values:", palpationData);

        // Broadcast the updated data to WebSocket clients
        // broadcastToClients(JSON.stringify(palpationData));
      } else {
        console.warn("Invalid data: Not a number.");
      }
    } else {
      console.warn("Invalid JSON format. 'ack' or 'data' key missing.");
    }
  } catch (error) {
    console.error("Error parsing JSON data:", error.message);
  }
});


// Utility: Update force value in Q1~Q5 in a circular manner and check completion
function updateForceValue(number) {
  const keys = Object.keys(palpationData);
  palpationData[keys[currRegions]].force = number;

  currRegions = (currRegions + 1) % keys.length;

  if (isAllForcesFilled()) {
    console.log("All forces filled. Posting palpation data...");
    postPalpationData(8001011234567, palpationData);
    resetForceValues();
  }
}

// Utility: Reset all force values to null after posting
function resetForceValues() {
  Object.keys(palpationData).forEach(key => {
    palpationData[key].force = null;
  });
  currRegions = 0; // 인덱스 초기화
}

// Utility: Check if all force values are filled
function isAllForcesFilled() {
  return Object.values(palpationData).every(entry => entry.force !== null);
}

// Utility: Broadcast message to all WebSocket clients
function broadcastToClients(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Utility: Fetch from API with token
async function fetchWithToken(endpoint, options = {}) {
  if (!savedToken) {
    console.error('Token is not available!');
    return { success: false, error: 'Token is not available' };
  }

  const headers = {
    'Authorization': `Bearer ${savedToken}`,
    'Accept': 'application/json',
    ...options.headers,
  };

  try {
    const response = await fetch(`${process.env.REST_API_URL}${endpoint}`, { ...options, headers });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error.message);
    return { success: false, error: error.message };
  }
}

// API: Get Token
async function getToken() {
  try {
    const response = await fetch(`${process.env.REST_API_URL}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ password: process.env.PASSWORD }),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    savedToken = data.token;
    return savedToken;
  } catch (error) {
    console.error('Error while fetching token:', error.message);
    return null;
  }
}

// API: Post Palpation Data
async function postPalpationData(patientID, data) {
  try {
    const response = await fetch(`${process.env.REST_API_URL}/patient/data/${patientID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${savedToken}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    console.log('Palpation data posted successfully.');
  } catch (error) {
    console.error('Error posting palpation data:', error.message);
  }
}

// Handle WebSocket Messages
function parseMessage(ws, message) {
  console.log('Received message:', message);

  const messageType = /^\d{13}$/.test(message) ? 'patientID' : message;

  switch (messageType) {
    case 'token':
      handleTokenRequest(ws);
      break;
    case 'patients':
      handleAllPatientsRequest(ws);
      break;
    case 'patientID':
      handlePatientRequest(ws, message);
      break;
    // case 'palpationData':
    //   postPalpationData(9212311234567, generatePalpationData());
    //   break;
    default:
      handleArduinoMessage(message);
  }
}

async function handleTokenRequest(ws) {
  const token = await getToken();
  const response = token
    ? { success: true, token }
    : { success: false, error: 'Failed to obtain token' };
  ws.send(JSON.stringify(response));
}

async function handlePatientRequest(ws, patientID) {
  const data = await fetchWithToken(`/patient/${patientID}`);
  ws.send(JSON.stringify(data));
}

async function handleAllPatientsRequest(ws) {
  const data = await fetchWithToken('/patient');
  ws.send(JSON.stringify(data));
}

function handleArduinoMessage(message) {
  serialPort.write(message, (err) => {
    if (err) {
      console.error('Error on write:', err.message);
    } else {
      console.log("Quest -> Arduino |", message);
    }
  });
}

// Utility: Generate dummy data for palpation
function generatePalpationData() {
  return {
    Q1: { pain: 1, force: null },
    Q2: { pain: 2, force: null },
    Q3: { pain: 3, force: null },
    Q4: { pain: 4, force: null },
    Q5: { pain: 5, force: null },
  };
}

// WebSocket Server
wss.on('connection', (ws) => {
  console.log("Client joined.");

  ws.on('message', (message) => parseMessage(ws, message));
  ws.on('close', () => console.log("Client left."));
});

// Start Server
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});