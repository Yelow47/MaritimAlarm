var map = L.map('map').setView([59.0, 10.0], 5);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

var shipMarkers = {};
var alarmMarkers = {};
var proximityTracker = {};
var lastSeenTracker = {};
const MAX_ALARMS = 4;
const INACTIVE_THRESHOLD = 3600000;

// GeoJSON layers for pipelines
var geojsonLayers = {
    gas: L.layerGroup().addTo(map),
    oil: L.layerGroup().addTo(map),
    fiber: L.layerGroup().addTo(map),
    condensate: L.layerGroup().addTo(map)
};

// GeoJSON layers for Norwegian zones
let norwegianZones = [];
function loadNorwegianZones() {
    const zoneFiles = ['data/svalbardsone.geojson', 'data/Okonomisk_sone.geojson'];
    Promise.all(zoneFiles.map(file => fetch(file).then(response => response.json())))
        .then(geojsons => {
            norwegianZones = geojsons.map(geojson => turf.buffer(geojson, 10, { units: 'kilometers' })); // Buffer zones by 10km
        })
        .catch(error => console.error('Error loading Norwegian zones:', error));
}
loadNorwegianZones();

// Check if a ship is within 10km of the border
function isWithin10kmOfBorder(latitude, longitude) {
    if (!norwegianZones.length) return false;
    const shipPoint = turf.point([longitude, latitude]);
    return norwegianZones.some(zone => turf.booleanContains(zone, shipPoint));
}

const statusMapping = {
    0: "Under way using engine",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuvrability",
    4: "Constrained by her draught",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way sailing",
    15: "Undefined"
};

function getShipIcon(rotation) {
    return L.divIcon({
        className: 'ship-icon',
        html: `<img src="data/ship.png" style="transform: rotate(${rotation}deg); width: 30px; height: 30px;" />`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
}

var alarmIcon = L.icon({
    iconUrl: 'data/alarm-icon.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

// Function to send an alarm to the backend
async function sendAlarmToBackend(alarm) {
    try {
        const response = await fetch('https://www.maritimalarm.no/receive.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ json_data: JSON.stringify(alarm), type: 'alarms' })
        });

        if (!response.ok) {
            console.error('Failed to send alarm to backend:', response.statusText);
        } else {
            console.log('Alarm sent to backend:', alarm);
        }
    } catch (error) {
        console.error('Error sending alarm to backend:', error);
    }
}

// Create an alarm and display it on the frontend
function createAlarm(name, mmsi, reason) {
    const alarm = { name, mmsi, reason, time: new Date().toISOString() };

    // Send the alarm to the backend
    sendAlarmToBackend(alarm);

    // Display the alarm in the "alarmer" box
    const alarmsBox = document.querySelector('.alarms-box');
    const alarmElement = document.createElement('div');
    alarmElement.classList.add('alarm-item');
    alarmElement.textContent = `Ship: ${name || "Unknown"} (MMSI: ${mmsi}) - ${reason}`;
    alarmsBox.appendChild(alarmElement);

    // Remove the oldest alarm if the box is full
    if (alarmsBox.children.length > MAX_ALARMS) {
        alarmsBox.removeChild(alarmsBox.firstChild);
    }
}
// Create modal elements
const modalOverlay = document.createElement('div');
modalOverlay.className = 'modal-overlay';

const modalBox = document.createElement('div');
modalBox.className = 'modal-box';
modalBox.innerHTML = `
    <button class="modal-close">&times;</button>
    <h2>Om nettsiden</h2>
    <p>Denne nettsidens formål er å overvåke sivil russisk skipsaktivitet i Norge, med hensikt å avdekke potensielle trusler mot norsk infrastruktur. 
Skipene vises i sanntid, og deres posisjon og aktivitet kan trigge "alarmer". 
En alarm trigges dersom et fartøy enten: Oppholder innenfor 2km av infrastruktur i over 1 time.
Eller: Slutter å transmitere AIS data i over 1 time.
Disse kriteriene kan justeres ved forespørsel.

NB:
Kartet viser kun russiske skip innenfor AIS mottakerrekkevidde, og eksluderer skip som er ankret/ligger til kai. 

All AIS data tilhører Kystverket, og er hentet gjennom Barentswatch.no sin API.
Hendvendelser kan sendes til MaritimAlarm@gmail.com

  </p>
`;

// Append modal elements to the body
document.body.appendChild(modalOverlay);
document.body.appendChild(modalBox);

// Show modal function
function showModal() {
    modalOverlay.style.display = 'block';
    modalBox.style.display = 'block';
}

// Hide modal function
function hideModal() {
    modalOverlay.style.display = 'none';
    modalBox.style.display = 'none';
}

// Add event listeners for open/close actions
const aboutButton = document.querySelector('.about-button');
const closeButton = modalBox.querySelector('.modal-close');

aboutButton.addEventListener('click', showModal);
closeButton.addEventListener('click', hideModal);
modalOverlay.addEventListener('click', hideModal);

// Function to classify and style pipelines
function classifyAndStylePipelines(feature) {
    let type = "Fiberkabel";
    let color = "green";

    const name = feature.properties?.name?.toLowerCase() || "";
    const description = feature.properties?.description?.toLowerCase() || "";
    const material = feature.properties?.m?.toLowerCase() || "";

    if (
        name.includes("gas") ||
        name.includes("gass") ||
        description.includes("gas") ||
        description.includes("gass") ||
        material.includes("gas") ||
        material.includes("gass")
    ) {
        type = "Gassrør";
        color = "blue";
    } else if (
        name.includes("oil") ||
        name.includes("olje") ||
        description.includes("oil") ||
        description.includes("olje") ||
        material.includes("oil") ||
        material.includes("olje")
    ) {
        type = "Oljerør";
        color = "black";
    } else if (
        name.includes("condensate") ||
        name.includes("kondensat") ||
        description.includes("condensate") ||
        description.includes("kondensat") ||
        material.includes("condensate") ||
        material.includes("kondensat")
    ) {
        type = "Kondensatrør";
        color = "purple";
    }

    feature.properties.type = type;

    return { color: color, weight: 4, interactive: true }; // Increased weight for easier clicking
}

// Function to load and classify GeoJSON files
function loadAndClassifyGeoJSON(filePath) {
    fetch(filePath)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error while fetching GeoJSON: ${response.status}`);
            return response.json();
        })
        .then(data => {
            let features;

            if (data.type === "FeatureCollection") {
                features = data.features;
            } else if (data.type === "Feature") {
                features = [data];
            } else {
                console.error(`Invalid GeoJSON format in file: ${filePath}`);
                return;
            }

            features.forEach(feature => {
                const style = classifyAndStylePipelines(feature);
                const type = feature.properties?.type;

                const layer = L.geoJSON(feature, {
                    style,
                    onEachFeature: function (feature, layer) {
                        const name = feature.properties?.name || "Unknown Cable/Pipe";
                        const type = feature.properties?.type || "Unknown Type";

                        layer.bindPopup(`
                            <strong>Name:</strong> ${name}<br>
                            <strong>Type:</strong> ${type}
                        `);
                    }
                });

                if (type === "Gassrør") {
                    layer.addTo(geojsonLayers.gas);
                } else if (type === "Oljerør") {
                    layer.addTo(geojsonLayers.oil);
                } else if (type === "Fiberkabel") {
                    layer.addTo(geojsonLayers.fiber);
                } else if (type === "Kondensatrør") {
                    layer.addTo(geojsonLayers.condensate);
                }
            });
        })
        .catch(error => console.error(`Error loading GeoJSON (File: ${filePath}):`, error));
}
// Add layer selector buttons dynamically
function addLayerSelector() {
    const leftPanel = document.querySelector('.left-panel');

    // Check if the layer-selector already exists to prevent duplication
    let selectorContainer = document.querySelector('.layer-selector');
    if (selectorContainer) return; // Exit if the selector container is already created

    selectorContainer = document.createElement('div');
    selectorContainer.classList.add('layer-selector');

    const layers = [
        { label: "Gassrør", type: "gas", color: "blue" },
        { label: "Oljerør", type: "oil", color: "black" },
        { label: "Fiberkabel", type: "fiber", color: "green" },
        { label: "Kondensatrør", type: "condensate", color: "purple" }
    ];

    layers.forEach(layer => {
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = "flex";
        buttonContainer.style.alignItems = "center";
        buttonContainer.style.marginBottom = "10px";

        const label = document.createElement('span');
        label.textContent = layer.label;
        label.style.color = "white";
        label.style.marginRight = "10px";
        buttonContainer.appendChild(label);

        const button = document.createElement('button');
        button.style.backgroundColor = layer.color;
        button.style.width = "30px";
        button.style.height = "30px";
        button.style.border = "none";
        button.style.borderRadius = "5px";
        button.style.cursor = "pointer";
        button.style.opacity = "1.0";
        button.title = `Toggle ${layer.label}`; // Add hover tooltip for clarity

        // Add event listener to toggle layers
        button.addEventListener('click', () => {
            console.log(`Button clicked for layer: ${layer.type}`); // Debugging log
            if (geojsonLayers[layer.type]) {
                if (map.hasLayer(geojsonLayers[layer.type])) {
                    console.log(`Removing layer: ${layer.type}`);
                    map.removeLayer(geojsonLayers[layer.type]);
                    button.style.opacity = "0.5"; // Dim the button to indicate it's inactive
                } else {
                    console.log(`Adding layer: ${layer.type}`);
                    map.addLayer(geojsonLayers[layer.type]);
                    button.style.opacity = "1.0"; // Brighten the button to indicate it's active
                }
            } else {
                console.error(`Layer type "${layer.type}" not found in geojsonLayers.`);
            }
        });

        buttonContainer.appendChild(button);
        selectorContainer.appendChild(buttonContainer);
    });

    // Insert the selector container above the "Om nettsiden" button
    const aboutButton = leftPanel.querySelector('.about-button');
    if (aboutButton) {
        leftPanel.insertBefore(selectorContainer, aboutButton);
    } else {
        leftPanel.appendChild(selectorContainer); // Fallback in case "Om nettsiden" button is missing
    }
}

// Call the function to dynamically add the layer selectors
addLayerSelector();

// Fetch ship data and display markers
function fetchShipData() {
    fetch('https://www.maritimalarm.no/receive.php?type=ships')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error while fetching ship data: ${response.status}`);
            return response.json();
        })
        .then(shipData => {
            const currentTime = Date.now();
            Object.values(shipData).forEach(ship => {
                const { mmsi, latitude, longitude, heading, name, destination, navigational_status } = ship;

                if ([1, 5].includes(ship.navigational_status)) return;

                if (!lastSeenTracker[mmsi]) {
                    lastSeenTracker[mmsi] = { lastSeen: currentTime, name };
                } else {
                    lastSeenTracker[mmsi].lastSeen = currentTime;
                    lastSeenTracker[mmsi].alarmTriggered = false;
                }

                if (shipMarkers[mmsi]) {
                    map.removeLayer(shipMarkers[mmsi]);
                }
                const marker = L.marker([latitude, longitude], {
                    icon: getShipIcon(heading || 0)
                }).bindPopup(`
                    <strong>Name:</strong> ${name || "Unknown"}<br>
                    <strong>MMSI:</strong> ${mmsi}<br>
                    <strong>Destination:</strong> ${destination || "Unknown"}<br>
                    <strong>Heading:</strong> ${heading || "Unknown"}°<br>
                    <strong>Status:</strong> ${statusMapping[navigational_status] || "Unknown"}
                `);

                marker.addTo(map);
                shipMarkers[mmsi] = marker;
            });
        })
        .catch(error => console.error('Error fetching ship data:', error));
}

// Add layer selector and load pipelines dynamically
addLayerSelector();

const geojsonFiles = [
    'data/bodo.geojson',
    'data/celtic.geojson',
    'data/Eviny.geojson',
    'data/havfrue.geojson',
    'data/havsil.geojson',
    'data/leif.geojson',
    'data/no-uk.geojson',
    'data/polar.geojson',
    'data/skagenfiber.geojson',
    'data/skagerrak.geojson',
    'data/svalbard.geojson',
    'data/tampnet.geojson',
    'data/tverrlingen.geojson',
    'data/viking.geojson',
    'data/viking2.geojson',
    'data/asgard.geojson',
    'data/draugen.geojson',
    'data/edvard.geojson',
    'data/Europipe.geojson',
    'data/Europipe2.geojson',
    'data/Europipe3.geojson',
    'data/franpipe.geojson',
    'data/gjøa.geojson',
    'data/gjøaolje.geojson',
    'data/grane.geojson',
    'data/graneolje.geojson',
    'data/gudrungass.geojson',
    'data/gudrunolje.geojson',
    'data/haltenpipe.geojson',
    'data/heidrungass.geojson',
    'data/johangass.geojson',
    'data/johanolje.geojson',
    'data/kvitebjørngass.geojson',
    'data/kvitebjørnolje.geojson',
    'data/langeled.geojson',
    'data/langeled1.geojson',
    'data/martin.geojson',
    'data/norne.geojson',
    'data/norpipe.geojson',
    'data/norpipe1.geojson',
    'data/norpipe2.geojson',
    'data/norpipegass.geojson',
    'data/norpipeolje.geojson',
    'data/norpipeolje1.geojson',
    'data/norpipeolje3.geojson',
    'data/ormen.geojson',
    'data/ormen2.geojson',
    'data/oseberg.geojson',
    'data/oseberg2.geojson',
    'data/polarled.geojson',
    'data/skarv.geojson',
    'data/sleipner.geojson',
    'data/snohvit.geojson',
    'data/SnøhvitF.geojson',
    'data/statpipe.geojson',
    'data/statpipe2.geojson',
    'data/statpipe3.geojson',
    'data/statpipe4.geojson',
    'data/statpipe5.geojson',
    'data/statpipe6.geojson',
    'data/tampen.geojson',
    'data/troll1.geojson',
    'data/trollgass.geojson',
    'data/trollgass1.geojson',
    'data/trollolje.geojson',
    'data/trollolje1.geojson',
    'data/ula.geojson',
    'data/utsirehoyden.geojson',
    'data/valemon.geojson',
    'data/vesterled.geojson',
    'data/vestprosess.geojson',
    'data/Visund.geojson',
    'data/zeepipe.geojson',
    'data/zeepipe1.geojson',
    'data/zeepipe2.geojson',
    'data/zeepipe3.geojson',
    'data/zeepipe4.geojson'
];


geojsonFiles.forEach(filePath => loadAndClassifyGeoJSON(filePath));

// Periodically fetch ship data and check last-seen status
setInterval(fetchShipData, 10000);
setInterval(() => {
    const currentTime = Date.now();
    for (const mmsi in lastSeenTracker) {
        if (currentTime - lastSeenTracker[mmsi].lastSeen > INACTIVE_THRESHOLD && !lastSeenTracker[mmsi].alarmTriggered) {
            const shipMarker = shipMarkers[mmsi];
            if (!shipMarker) continue;

            const { lat, lng } = shipMarker.getLatLng();
            if (!isWithin10kmOfBorder(lat, lng)) {
                createAlarm(lastSeenTracker[mmsi].name, mmsi, "Inactive for over 1 hour");
                lastSeenTracker[mmsi].alarmTriggered = true;
            }
        }
    }
}, 60000);
