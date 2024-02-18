const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = 8000;

app.use(bodyParser.json());

// Connect to SQLite database (in-memory for simplicity)
//const db = new sqlite3.Database(':memory:');
const db = new sqlite3.Database("train.db");

// Create User table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    user_name TEXT,
    balance INTEGER
  )
`);

// Create Station table
db.run(`
  CREATE TABLE IF NOT EXISTS stations (
    station_id INTEGER PRIMARY KEY,
    station_name TEXT,
    longitude FLOAT,
    latitude FLOAT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS trains (
    train_id INTEGER PRIMARY KEY,
    train_name TEXT,
    capacity INTEGER,
    service_start TEXT,
    service_ends TEXT,
    num_stations INTEGER
  )
`);

// Create Stops table
db.run(`
  CREATE TABLE IF NOT EXISTS stops (
    stop_id INTEGER PRIMARY KEY,
    train_id INTEGER,
    station_id INTEGER,
    arrival_time TEXT,
    departure_time TEXT,
    fare INTEGER,
    FOREIGN KEY (train_id) REFERENCES trains (train_id),
    FOREIGN KEY (station_id) REFERENCES stations (station_id)
  )
`);

// Create API endpoint to create users
app.post("/api/users", (req, res) => {
  const { user_name, balance } = req.body;

  // Insert the new user
  db.run(
    "INSERT INTO users (user_name, balance) VALUES (?, ?)",
    [user_name, balance],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Internal Server Error" });
      }

      // Return the created user
      res.status(201).json({
        user_id: this.lastID,
        user_name,
        balance,
      });
    }
  );
});

// Create API endpoint to add stations
app.post("/api/stations", (req, res) => {
  const { station_id, station_name, longitude, latitude } = req.body;

  // Insert the new station
  db.run(
    "INSERT INTO stations (station_id, station_name, longitude, latitude) VALUES (?, ?, ?, ?)",
    [station_id, station_name, longitude, latitude],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Internal Server Error" });
      }

      // Return the created station
      res.status(201).json({
        station_id: this.lastID,
        station_name,
        longitude,
        latitude,
      });
    }
  );
});
app.get("/api/stations", (req, res) => {
  // Fetch all stations from the database
  db.all("SELECT * FROM stations", (err, stations) => {
    if (err) {
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Return the list of stations
    res.status(200).json({ stations });
  });
});
// Create API endpoint to add trains
app.post("/api/trains", (req, res) => {
  const { train_id, train_name, capacity, stops } = req.body;

  // Extract service start and end times
  const service_start = stops[0].departure_time;
  const service_ends = stops[stops.length - 1].arrival_time;

  // Insert the new train
  db.run(
    "INSERT INTO trains (train_id, train_name, capacity, service_start, service_ends, num_stations) VALUES (?, ?, ?, ?, ?, ?)",
    [train_id, train_name, capacity, service_start, service_ends, stops.length],
    function (err) {
      if (err) {
        console.error(err.message);
        return res
          .status(500)
          .json({ error: "Internal Server Error", details: err.message });
      }

      // Insert stops for the train
      stops.forEach((stop, index) => {
        db.run(
          "INSERT INTO stops (train_id, station_id, arrival_time, departure_time, fare) VALUES (?, ?, ?, ?, ?)",
          [
            train_id,
            stop.station_id,
            stop.arrival_time,
            stop.departure_time,
            stop.fare,
          ],
          (err) => {
            if (err) {
              console.error(err.message);
              return res
                .status(500)
                .json({ error: "Internal Server Error", details: err.message });
            }

            // If this is the last stop, return the response
            if (index === stops.length - 1) {
              res.status(201).json({
                train_id,
                train_name,
                capacity,
                service_start,
                service_ends,
                num_stations: stops.length,
              });
            }
          }
        );
      });
    }
  );
});
// Create API endpoint to list all trains at a specific station
app.get("/api/stations/:station_id/trains", (req, res) => {
  const stationId = req.params.station_id;

  // Fetch the station from the database
  db.get("SELECT * FROM stations WHERE station_id = ?", [stationId], (err, station) => {
    if (err) {
      return res.status(500).json({ error: "Internal Server Error", details: err.message });
    }

    // If the station does not exist, return a 404 response
    if (!station) {
      return res.status(404).json({ message: `Station with id: ${stationId} was not found` });
    }

    // Fetch all trains at the specified station
    const query = `
      SELECT trains.train_id, stops.arrival_time, stops.departure_time
      FROM stops
      JOIN trains ON stops.train_id = trains.train_id
      WHERE stops.station_id = ?
    `;

    db.all(query, [stationId], (err, trains) => {
      if (err) {
        return res.status(500).json({ error: "Internal Server Error", details: err.message });
      }

      // Return the list of trains at the station
      res.status(200).json({ station_id: stationId, trains });
    });
  });
});
// Create API endpoint to get wallet balance
app.get("/api/wallets/:wallet_id", (req, res) => {
  const walletId = req.params.wallet_id;

  // Fetch the wallet information from the user table
  const query = `
    SELECT users.user_id, users.user_name, users.balance
    FROM users
    WHERE users.user_id = ?
  `;

  db.get(query, [walletId], (err, wallet) => {
    if (err) {
      return res.status(500).json({ error: "Internal Server Error", details: err.message });
    }

    // If the wallet does not exist, return a 404 response
    if (!wallet) {
      return res.status(404).json({ message: `Wallet with id: ${walletId} was not found` });
    }

    // Return the wallet information
    const response = {
      wallet_id: walletId,
      balance: wallet.balance,
      wallet_user: {
        user_id: wallet.user_id,
        user_name: wallet.user_name,
      },
    };

    res.status(200).json(response);
  });
});
// Create API endpoint to add funds to the wallet
app.put("/api/wallets/:wallet_id", (req, res) => {
  const walletId = req.params.wallet_id;
  const { recharge } = req.body;

  // Check if the wallet exists
  const checkWalletQuery = "SELECT * FROM users WHERE user_id = ?";
  db.get(checkWalletQuery, [walletId], (err, wallet) => {
    if (err) {
      return res.status(500).json({ error: "Internal Server Error", details: err.message });
    }

    // If the wallet does not exist, return a 404 response
    if (!wallet) {
      return res.status(404).json({ message: `Wallet with id: ${walletId} was not found` });
    }

    // Check if the recharge amount is within the valid range (100 - 10000)
    if (recharge < 100 || recharge > 10000) {
      return res.status(400).json({ message: `Invalid amount: ${recharge}` });
    }

    // Update the wallet balance
    const updatedBalance = wallet.balance + recharge;
    const updateWalletQuery = "UPDATE users SET balance = ? WHERE user_id = ?";
    db.run(updateWalletQuery, [updatedBalance, walletId], function (err) {
      if (err) {
        return res.status(500).json({ error: "Internal Server Error", details: err.message });
      }

      // Return the updated wallet information
      const response = {
        wallet_id: walletId,
        balance: updatedBalance,
        wallet_user: {
          user_id: wallet.user_id,
          user_name: wallet.user_name,
        },
      };

      res.status(200).json(response);
    });
  });
});



app.post('/api/tickets', (req, res) => {
  const { wallet_id, time_after, station_from, station_to } = req.body;

  // Validate request body
  if (!wallet_id || !time_after || !station_from || !station_to) {
      return res.status(400).json({ message: 'Missing required parameters' });
  }

  // Calculate ticket fare
  let totalFare = calculateTicketFare(station_from, station_to);

  // Check wallet balance
  db.get(`SELECT balance FROM users WHERE user_id = ?`, [wallet_id], (err, row) => {
      if (err) {
          console.error('Error retrieving wallet balance:', err);
          return res.status(500).json({ message: 'Internal server error' });
      }

      const walletBalance = row ? row.balance : 0;

      // Check if wallet balance is sufficient
      if (walletBalance < totalFare) {
          const shortageAmount = totalFare - walletBalance;
          return res.status(402).json({ message: `Recharge amount: ${shortageAmount} to purchase the ticket` });
      }

      // Find available trains
      findAvailableTrains(station_from, station_to, time_after, (err, trains) => {
          if (err) {
              console.error('Error finding available trains:', err);
              return res.status(500).json({ message: 'Internal server error' });
          }

          if (!trains.length) {
              return res.status(403).json({ message: `No ticket available for station: ${station_from} to station: ${station_to}` });
          }

          // Generate ticket ID
          generateTicketID((err, ticketId) => {
              if (err) {
                  console.error('Error generating ticket ID:', err);
                  return res.status(500).json({ message: 'Internal server error' });
              }
              
              // Generate stations list
              generateStationsList(trains, (err, stations) => {
                  if (err) {
                      console.error('Error generating stations list:', err);
                      return res.status(500).json({ message: 'Internal server error' });
                  }

                  // Generate ticket details
                  const ticket = {
                      ticket_id: ticketId,
                      balance: walletBalance - totalFare,
                      wallet_id: wallet_id,
                      stations: stations
                  };

                  // Store ticket details in the database
                  db.run(`INSERT INTO Ticket (ticket_id, wallet_id, balance) VALUES (?, ?, ?)`, [ticketId, wallet_id, ticket.balance], (err) => {
                    if (err) {
                        console.error('Error storing ticket details:', err);
                        return res.status(500).json({ message: 'Internal server error' });
                    }
                
                    // Update the user's balance in the users table
                    db.run(`UPDATE users SET balance = ? WHERE user_id = ?`, [walletBalance - totalFare, wallet_id], (err) => {
                        if (err) {
                            console.error('Error updating user balance:', err);
                            return res.status(500).json({ message: 'Internal server error' });
                        }
                
                        // Return ticket details
                        res.status(201).json(ticket);
                    });
                });
              });
          });
      });
  });
});


// Function to calculate ticket fare
function calculateTicketFare(station_from, station_to) {
  // Placeholder implementation for calculating fare based on stations
  return Math.abs(station_to - station_from) * 10; // Fare calculation logic can be more complex
}

// Function to find available trains
// Function to find available trains
function findAvailableTrains(station_from, station_to, time_after, callback) {
  const query = `
      SELECT DISTINCT t.train_id, s.departure_time
      FROM trains t
      JOIN Stops s ON t.train_id = s.train_id
      WHERE s.station_id >= ? AND s.station_id <= ?
          AND s.departure_time >= ?
  `;
  const params = [station_from, station_to, time_after];

  db.all(query, params, (err, rows) => {
      if (err) {
          callback(err);
          return;
      }

      const availableTrains = rows.map(row => ({
          train_id: row.train_id,
          departure_time: row.departure_time
      }));

      callback(null, availableTrains);
  });
}
db.run(`CREATE TABLE IF NOT EXISTS Ticket (
  ticket_id INTEGER PRIMARY KEY,
  wallet_id INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES users(user_id)
)`);

// Function to generate ticket ID
function generateTicketID(callback) {
  db.get("SELECT MAX(ticket_id) AS max_id FROM Ticket", (err, row) => {
      if (err) {
          callback(err);
          return;
      }
      const maxID = row.max_id || 0;
      const ticketID = maxID + 1;
      callback(null, ticketID);
  });
}

// Function to generate list of stations in order of visits
function generateStationsList(trains, callback) {
  let stationsMap = new Map(); // Use a map to store unique stations

  // Iterate through each train to fetch its stops
  let completed = 0;
  trains.forEach(train => {
      db.all('SELECT * FROM Stops WHERE train_id = ? ORDER BY departure_time ASC', [train.train_id], (err, stops) => {
          if (err) {
              callback(err, null);
              return;
          }

          // Add stops to the map
          stops.forEach(stop => {
              const key = `${stop.station_id}_${train.train_id}`; // Unique key for station and train combination
              if (!stationsMap.has(key)) {
                  stationsMap.set(key, {
                      station_id: stop.station_id,
                      train_id: train.train_id,
                      arrival_time: stop.arrival_time,
                      departure_time: stop.departure_time
                  });
              }
          });

          // Check if all trains have been processed
          completed++;
          if (completed === trains.length) {
              // Convert map values to array and sort by departure time
              const stationsList = Array.from(stationsMap.values()).sort((a, b) => {
                  if (a.departure_time < b.departure_time) return -1;
                  if (a.departure_time > b.departure_time) return 1;
                  return 0;
              });

              // Return the generated stations list
              callback(null, stationsList);
          }
      });
  });
}








app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
