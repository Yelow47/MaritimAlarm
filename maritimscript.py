import requests
import json
from datetime import datetime

TOKEN_URL = "https://id.barentswatch.no/connect/token"
API_URL = "https://live.ais.barentswatch.no/v1/combined?modelType=Full&modelFormat=Geojson"
CLIENT_ID = "XXXXXXXXXXXXXXX"
CLIENT_SECRET = "XXXXXXXXXXX"
SCOPE = "XXXX"
RECEIVE_URL = "https://www.maritimalarm.no/receive.php"
SHADOWFLEET_PATH = "/home/XXXXX/XXXXXX/shadowfleet.json"

ships = {}

status_mapping = {
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
}

def serialize_datetime(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError("Type not serializable")

def load_shadowfleet():
    try:
        with open(SHADOWFLEET_PATH, "r") as file:
            data = json.load(file)
            if isinstance(data, list):
                shadowfleet_set = {str(mmsi) for mmsi in data}  # Convert MMSI numbers to strings
                print(f"Shadowfleet loaded: {len(shadowfleet_set)} MMSI numbers.")
                return shadowfleet_set
            else:
                print("Invalid shadowfleet.json format. Expected a list of MMSI numbers.")
                return set()
    except Exception as e:
        print(f"Failed to load shadowfleet.json: {e}")
        return set()

def get_access_token():
    try:
        payload = f"client_id={CLIENT_ID}&scope={SCOPE}&client_secret={CLIENT_SECRET}&grant_type=client_credentials"
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        response = requests.post(TOKEN_URL, data=payload, headers=headers)
        response.raise_for_status()
        token_data = response.json()
        print("Access token obtained successfully.")
        return token_data["access_token"]
    except requests.exceptions.RequestException as e:
        print(f"Error obtaining token: {e}")
        raise Exception(f"Failed to get token: {e}")

def send_data_to_server(data, data_type):
    try:
        json_data = json.dumps(data, default=serialize_datetime)
        response = requests.post(RECEIVE_URL, data={"json_data": json_data, "type": data_type})
        print(f"Data Sent: {json_data}")
        print(f"Response Status Code: {response.status_code}")
        print(f"Response Text: {response.text}")
        response.raise_for_status()
        print(f"{data_type.capitalize()} data sent to {RECEIVE_URL} successfully!")
    except requests.exceptions.RequestException as e:
        print(f"Failed to send {data_type} data to {RECEIVE_URL}: {e}")

def fetch_continuous_stream(token, shadowfleet_mmsi):
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        payload = {
            "modelType": "Full",
            "Downsample": False
        }
        print("Connecting to API for continuous stream...")
        with requests.post(API_URL, json=payload, headers=headers, stream=True) as response:
            response.raise_for_status()
            print("Connection established. Streaming data...")

            for line in response.iter_lines():
                if line:
                    try:
                        ship_data = json.loads(line.decode('utf-8'))
                        print(f"Received Ship Data: {ship_data}")
                        mmsi = str(ship_data["mmsi"])  # Ensure MMSI is treated as a string

                        # Debugging: Check if MMSI is processed correctly
                        print(f"Processing MMSI: {mmsi}")

                        # Update ship tracking
                        if mmsi not in ships:
                            ships[mmsi] = {"mmsi": mmsi, "last_seen": datetime.utcnow()}
                        else:
                            ships[mmsi]["last_seen"] = datetime.utcnow()

                        ships[mmsi].update({
                            "latitude": ship_data.get("latitude"),
                            "longitude": ship_data.get("longitude"),
                            "navigational_status": ship_data.get("navigationalStatus"),
                            "speed_over_ground": ship_data.get("speedOverGround"),
                            "heading": ship_data.get("trueHeading"),
                            "name": ship_data.get("name", "Unknown"),
                            "destination": ship_data.get("destination", "Unknown"),
                            "status_text": status_mapping.get(ship_data.get("navigationalStatus"), "Unknown")
                        })

                        # Check and send data based on shadowfleet or Russian criteria
                        if mmsi in shadowfleet_mmsi:
                            print(f"MMSI {mmsi} is in the Shadowfleet. Sending as 'ships'.")
                            send_data_to_server(ships[mmsi], "ships")
                        elif ship_data.get("countryCode") == "RU" or mmsi.startswith("273"):
                            print(f"MMSI {mmsi} is a Russian ship. Sending as 'ships'.")
                            send_data_to_server(ships[mmsi], "ships")
                        else:
                            print(f"MMSI {mmsi} does not match Russian or Shadowfleet criteria. Skipping.")
                    except json.JSONDecodeError as e:
                        print(f"Failed to decode JSON line: {line}, Error: {e}")
    except requests.exceptions.RequestException as e:
        print(f"Error fetching AIS data: {e}")
        raise Exception(f"Failed to fetch AIS data: {e}")

def main():
    try:
        shadowfleet_mmsi = load_shadowfleet()
        print(f"Loaded {len(shadowfleet_mmsi)} MMSI numbers from shadowfleet.json.")
        token = get_access_token()
        print(f"Token: {token}")
        fetch_continuous_stream(token, shadowfleet_mmsi)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
