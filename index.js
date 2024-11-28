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

// Initialize SerialPort
const serialPort = new SerialPort({
  path: process.env.SERIAL_PORT_PATH || '/dev/cu.usbmodem1101',
  baudRate: 115200,
});

serialPort.on('error', (err) => console.error('SerialPort Error:', err.message));

serialPort.on('data', (data) => {
  const dataString = data.toString();
  console.log("Arduino -> Quest |", dataString);

  // Broadcast data to all WebSocket clients
  broadcastToClients(dataString);
});

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
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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

// API: Get Token
async function postPalpationData(patientID) {
  try {
    const response = await fetch(`${process.env.REST_API_URL}/patient/data/${patientID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${savedToken}` },
      body: JSON.stringify({ 
        "Q1": {
          "pain": 0,
          "force": 0
        },
        "Q2": {
          "pain": 0,
          "force": 0
        },
        "Q3": {
          "pain": 0,
          "force": 0
        },
        "Q4": {
          "pain": 0,
          "force": 0
        }
      }),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    console.log("Succeed to post palpation data");
  } catch (error) {
    console.error('Error while adding palpation data:', error.message);
    return null;
  }
}

// API: Get Patient by ID
async function getPatient(patientID) {
  return await fetchWithToken(`/patient/${patientID}`);
}

// API: Get All Patients
async function getAllPatients() {
  return await fetchWithToken('/patient');
}

// Handle WebSocket Messages
function parseMessage(ws, message) {
  console.log('Received message:', message);

  const messageType = /^\d{13}$/.test(message) ? 'patientId' : message;

  switch (messageType) {
    case 'token':
      handleTokenRequest(ws);
      break;
    case 'patients':
      handleAllPatientsRequest(ws);
      break;
    case 'patientId':
      handlePatientRequest(ws, message);
      break;
    case 'palpationData':
      postPalpationData(9212311234567);
      break;
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
  const data = await getPatient(patientID);
  ws.send(JSON.stringify(data));
}

async function handleAllPatientsRequest(ws) {
  const data = await getAllPatients();
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