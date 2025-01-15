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

// Updated Alarm Functions
async function sendAlarmToBackend(alarm) {
    try {
        const response = await fetch('https://www.maritimalarm.no/receive.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ 
                json_data: JSON.stringify(alarm), 
                type: 'alarms',
                action: 'save'
            })
        });

        if (!response.ok) {
            console.error('Failed to send alarm to backend:', response.statusText);
        } else {
            console.log('Alarm sent to backend:', alarm);
            fetchAndDisplayAlarms();
        }
    } catch (error) {
        console.error('Error sending alarm to backend:', error);
    }
}

async function fetchAndDisplayAlarms() {
    try {
        const response = await fetch('https://www.maritimalarm.no/receive.php?type=alarms&action=fetch');
        if (!response.ok) {
            throw new Error(`HTTP error while fetching alarms: ${response.status}`);
        }
        const alarms = await response.json();
        
        const alarmsBox = document.querySelector('.alarms-box');
        alarmsBox.innerHTML = '';
        
        const recentAlarms = alarms.slice(-MAX_ALARMS);
        recentAlarms.forEach(alarm => {
            const alarmElement = document.createElement('div');
            alarmElement.classList.add('alarm-item');
            alarmElement.textContent = `Ship: ${alarm.name || "Unknown"} (MMSI: ${alarm.mmsi}) - ${alarm.reason}`;
            alarmsBox.appendChild(alarmElement);
        });
    } catch (error) {
        console.error('Error fetching alarms:', error);
    }
}

function createAlarm(name, mmsi, reason) {
    const alarm = {
        name,
        mmsi,
        reason,
        time: new Date().toISOString()
    };
    sendAlarmToBackend(alarm);
}

// Initialize alarms display
document.addEventListener('DOMContentLoaded', () => {
    fetchAndDisplayAlarms();
});

// Refresh alarms every 30 seconds
setInterval(fetchAndDisplayAlarms, 30000);

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

    let selectorContainer = document.querySelector('.layer-selector');
    if (selectorContainer) return;

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
        button.title = `Toggle ${layer.label}`;

        button.addEventListener('click', () => {
            if (geojsonLayers[layer.type]) {
                if (map.hasLayer(geojsonLayers[layer.type])) {
                    map.removeLayer(geojsonLayers[layer.type]);
                    button.style.opacity = "0.5";
                } else {
                    map.addLayer(geojsonLayers[layer.type]);
                    button.style.opacity = "1.0";
                }
            }
        });

        buttonContainer.appendChild(button);
        selectorContainer.appendChild(buttonContainer);
    });

    const aboutButton = leftPanel.querySelector('.about-button');
    if (aboutButton) {
        leftPanel.insertBefore(selectorContainer, aboutButton);
    } else {
        leftPanel.appendChild(selectorContainer);
    }
}

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

// Adding alarm conditions for proximity and low-speed vessels
const PROXIMITY_THRESHOLD = 1852; // 1 nautical mile in meters
const LOW_SPEED_MIN = 2; // knots
const LOW_SPEED_MAX = 5; // knots
const LOW_SPEED_DURATION = 1800000; // 30 minutes in milliseconds

var speedTracker = {};

// Modify the fetchShipData function to include proximity and low-speed checks
function fetchShipData() {
    fetch('https://www.maritimalarm.no/receive.php?type=ships')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error while fetching ship data: ${response.status}`);
            return response.json();
        })
        .then(shipData => {
            const currentTime = Date.now();
            Object.values(shipData).forEach(ship => {
                const { mmsi, latitude, longitude, heading, name, destination, navigational_status, speed_over_ground } = ship;

                if ([1, 5].includes(navigational_status)) return;

                // Update last seen tracker
                if (!lastSeenTracker[mmsi]) {
                    lastSeenTracker[mmsi] = { lastSeen: currentTime, name };
                } else {
                    lastSeenTracker[mmsi].lastSeen = currentTime;
                    lastSeenTracker[mmsi].alarmTriggered = false;
                }

                // Proximity check
                if (!proximityTracker[mmsi]) {
                    proximityTracker[mmsi] = { proximityStart: null };
                }
                const isCloseToInfra = checkProximityToInfrastructure(latitude, longitude);
                if (isCloseToInfra) {
                    if (!proximityTracker[mmsi].proximityStart) {
                        proximityTracker[mmsi].proximityStart = currentTime;
                    } else if (currentTime - proximityTracker[mmsi].proximityStart > 3600000) {
                        createAlarm(name, mmsi, "Within 1 nautical mile of infrastructure for over 1 hour");
                        proximityTracker[mmsi].proximityStart = null;
                    }
                } else {
                    proximityTracker[mmsi].proximityStart = null;
                }

                // Low-speed check
                if (!speedTracker[mmsi]) {
                    speedTracker[mmsi] = { lowSpeedStart: null };
                }
                if (speed_over_ground >= LOW_SPEED_MIN && speed_over_ground <= LOW_SPEED_MAX) {
                    if (!speedTracker[mmsi].lowSpeedStart) {
                        speedTracker[mmsi].lowSpeedStart = currentTime;
                    } else if (currentTime - speedTracker[mmsi].lowSpeedStart > LOW_SPEED_DURATION) {
                        createAlarm(name, mmsi, "Maintained a speed of 2-5 knots for over 30 minutes");
                        speedTracker[mmsi].lowSpeedStart = null;
                    }
                } else {
                    speedTracker[mmsi].lowSpeedStart = null;
                }

                // Update or create ship marker
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
                    <strong>Status:</strong> ${statusMapping[navigational_status] || "Unknown"}<br>
                    <strong>Speed:</strong> ${speed_over_ground || "Unknown"} knots
                `);

                marker.addTo(map);
                shipMarkers[mmsi] = marker;
            });
        })
        .catch(error => console.error('Error fetching ship data:', error));
}

// Helper function to check proximity to infrastructure
function checkProximityToInfrastructure(lat, lon) {
    
    function checkProximityToInfrastructure(lat, lon) {
        let isClose = false;
        geojsonFiles.forEach(filePath => {
            fetch(filePath)
                .then(response => response.json())
                .then(data => {
                    if (data.type === "FeatureCollection" && data.features) {
                        data.features.forEach(feature => {
                            const coordinates = feature.geometry.coordinates;
                            const pipeline = turf.multiLineString(coordinates);
                            const shipPoint = turf.point([lon, lat]);
                            const distance = turf.pointToLineDistance(shipPoint, pipeline, { units: 'meters' });
                            if (distance <= PROXIMITY_THRESHOLD) {
                                isClose = true;
                            }
                        });
                    } else {
                        console.error('Invalid GeoJSON format in file:', filePath);
                    }
                })
                .catch(error => console.error('Error checking proximity:', error));
        });
        return isClose;
    }
    
    return Math.random() < 0.1; // Simulate a proximity check for testing
}

    fetch('https://www.maritimalarm.no/receive.php?type=ships')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error while fetching ship data: ${response.status}`);
            return response.json();
        })
        .then(shipData => {
            const currentTime = Date.now();
            Object.values(shipData).forEach(ship => {
                const { mmsi, latitude, longitude, heading, name, destination, navigational_status, speed_over_ground } = ship;

                if ([1, 5].includes(navigational_status)) return;

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
                    <strong>Status:</strong> ${statusMapping[navigational_status] || "Unknown"}<br>
                    <strong>Speed:</strong> ${speed_over_ground || "Unknown"} knots
                `);

                marker.addTo(map);
                shipMarkers[mmsi] = marker;
            });
        })
        .catch(error => console.error('Error fetching ship data:', error));

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

setInterval(fetchShipData, 10000);

// Add event listeners for layer buttons to toggle layers
document.addEventListener("DOMContentLoaded", function () {
    const layerButtons = {
        gas: document.querySelector('.layer-button.gas'),
        oil: document.querySelector('.layer-button.oil'),
        fiber: document.querySelector('.layer-button.fiber'),
        condensate: document.querySelector('.layer-button.condensate')
    };

    Object.entries(layerButtons).forEach(([layerType, button]) => {
        button.addEventListener("click", () => {
            const layer = geojsonLayers[layerType];
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
                button.classList.remove("active");
            } else {
                map.addLayer(layer);
                button.classList.add("active");
            }
        });
    });
});
