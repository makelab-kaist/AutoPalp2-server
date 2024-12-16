const Fastify = require('fastify');
const { createServer } = require('http');
const WebSocket = require('ws');
const { SerialPort } = require('serialport');
const fetch = require('node-fetch');
require("dotenv").config();

const fastify = Fastify({ logger: true });
const server = createServer(fastify.server);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// State variables
let savedToken = null; // Stores authentication token
let palpationData = {}; // Stores palpation data by region
let currRegionIndex = 1; // Tracks the current region index for palpation

// SerialPort Configuration
const serialPort = new SerialPort({
  path: process.env.SERIAL_PORT_PATH || '/dev/cu.usbmodem1101',
  baudRate: 115200,
});

serialPort.on('error', handleSerialPortError);
serialPort.on('data', handleSerialPortData);

// Serial Port Error Handler
function handleSerialPortError(err) {
  console.error('SerialPort Error:', err.message);
}

// Serial Port Data Handler
function handleSerialPortData(data) {
  const dataString = data.toString().trim();
  broadcastToClients(dataString);

  try {
    const parsedData = JSON.parse(dataString);

    if (parsedData.ack === "ready") {
      console.log("Arduino is ready.");
    } else if (parsedData.ack === "reset") {
      handleArduinoReset();
    } else if (parsedData.data) {
      processForceData(parsedData.data);
    } else {
      console.warn("Invalid JSON format. 'ack' or 'data' key missing.");
    }
  } catch (error) {
    console.error("Error parsing JSON data:", error.message);
  }
}

/**
 * Handles a reset signal from the Arduino, posting collected palpation data if available.
 */
function handleArduinoReset() {
  if (Object.keys(palpationData).length !== 0) {
    console.log("Final palpation data:", palpationData);
    postPalpationData(8001011234567, palpationData); // Replace hardcoded ID as needed
    palpationData = {};
  }
  console.log("Reset Arduino.");
}

/**
 * Processes force data received from Arduino.
 * @param {string|number} data - Force data to process.
 */
function processForceData(data) {
  const forceValue = parseInt(data, 10);
  if (!isNaN(forceValue)) {
    updateForceValue(forceValue);
  } else {
    console.warn("Invalid force data: Not a number.");
  }
}

/**
 * Updates force value for the current region.
 * @param {number} number - Force value.
 */
function updateForceValue(number) {
  const key = `R${currRegionIndex}`;
  palpationData[key] = { pain: null, force: null };
  palpationData[key].force = number;
}

/**
 * Updates pain value for the current region and increments the region index.
 * @param {number} number - Pain value.
 */
function updatePainValue(number) {
  const key = `R${currRegionIndex++}`;
  palpationData[key].pain = number;

  console.log(`Updated ${key}:`, palpationData[key]);
}

/**
 * Broadcasts a message to all connected WebSocket clients.
 * @param {string} message - Message to broadcast.
 */
function broadcastToClients(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Performs an authenticated fetch to the REST API.
 * @param {string} endpoint - API endpoint.
 * @param {object} options - Fetch options.
 * @returns {object} API response or error.
 */
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

/**
 * Fetches a new authentication token from the REST API.
 * @returns {string|null} The fetched token or null on failure.
 */
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

/**
 * Posts palpation data to the REST API.
 * @param {number} patientID - The patient's ID.
 * @param {object} data - Palpation data to post.
 */
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

/**
 * Parses incoming WebSocket messages.
 * @param {WebSocket} ws - The WebSocket client.
 * @param {string} message - The received message.
 */
function parseMessage(ws, message) {
  try {
    const parsedMessage = JSON.parse(message);
    if (parsedMessage.pain !== undefined) {
      updatePainValue(parsedMessage.pain);
      return;
    }
  } catch (e) {
    // Ignore JSON parsing errors and proceed with raw message handling
  }

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
    default:
      handleArduinoMessage(message);
  }
}

/**
 * WebSocket Handlers
 */
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
    }
  });
}

// WebSocket Server
wss.on('connection', (ws) => {
  console.log("Client joined.");

  ws.on('message', (message) => parseMessage(ws, message));
  ws.on('close', () => console.log("Client left."));
});

// Define a simple route to confirm server functionality
fastify.get('/', async (request, reply) => {
  return { message: 'Fastify server is running!' };
});

// Start Server
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});