<?php
// Add CORS headers for cross-origin requests
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Maximum size of JSON file in KB (1000 KB)
define('MAX_FILE_SIZE', 1000 * 1024);

// Time threshold for data retention (5 hours in seconds)
define('DATA_RETENTION_THRESHOLD', 5 * 60 * 60);

// Function to cleanup old ship data based on time and remove outdated entries
function pruneOldShipData($existingData, $newData) {
    $currentTime = time();

    // Filter out entries older than the threshold
    $existingData = array_filter($existingData, function ($entry) use ($currentTime) {
        return isset($entry['last_seen']) && (strtotime($entry['last_seen']) > ($currentTime - DATA_RETENTION_THRESHOLD));
    });

    // Update or add the new ship data
    $existingData[$newData['mmsi']] = $newData;

    return $existingData;
}

// Handle POST requests for receiving data
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['json_data']) && isset($_POST['type'])) {
        $data = json_decode($_POST['json_data'], true);
        $type = $_POST['type'];

        if ($type === 'ships') {
            $filePath = 'ship_data.json';
            $existingData = file_exists($filePath) ? json_decode(file_get_contents($filePath), true) : [];
            $existingData = pruneOldShipData($existingData, $data); // Prune old data and update with new data

            if (strlen(json_encode($existingData)) > MAX_FILE_SIZE) {
                echo "File size exceeded. Unable to save new data.";
                exit;
            }

            file_put_contents($filePath, json_encode($existingData, JSON_PRETTY_PRINT));
            echo "Ships data received and cleaned successfully.";
        } elseif ($type === 'alarms') {
            $filePath = 'alarm_data.json';
            $existingData = file_exists($filePath) ? json_decode(file_get_contents($filePath), true) : [];
            $existingData[] = $data;
            file_put_contents($filePath, json_encode($existingData, JSON_PRETTY_PRINT));
            echo "Alarms data received successfully.";
        } else {
            echo "Invalid type.";
        }
    } else {
        echo "Invalid POST data.";
    }
    exit;
}

// Handle GET requests for retrieving data
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['type'])) {
        $type = $_GET['type'];

        if ($type === 'ships') {
            if (file_exists('ship_data.json')) {
                header('Content-Type: application/json');
                echo file_get_contents('ship_data.json');
            } else {
                echo json_encode([]);
            }
        } elseif ($type === 'alarms') {
            if (file_exists('alarm_data.json')) {
                header('Content-Type: application/json');
                echo file_get_contents('alarm_data.json');
            } else {
                echo json_encode([]);
            }
        } else {
            echo "Invalid type.";
        }
    } else {
        echo "Invalid GET data.";
    }
    exit;
}

// Invalid request method
echo "Invalid request method.";
exit;
?>

