const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./licenses.db");
const ADMIN_SECRET = "MO27@ry6#Ta&";
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT,
    license_key TEXT UNIQUE,
    status TEXT,
    device_id TEXT,
    trial_end TEXT
  )`);

  db.run(`ALTER TABLE clients ADD COLUMN device_id TEXT`, (err) => {
    if (err) {
      console.log("device_id column already exists");
    }
  });

  db.run(`ALTER TABLE clients ADD COLUMN trial_end TEXT`, (err) => {
    if (err) {
      console.log("trial_end column already exists");
    }
  });
});

function checkAdmin(req, res) {

  const adminSecret = req.headers["x-admin-secret"];

  if (adminSecret !== ADMIN_SECRET) {
    res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
    return false;
  }

  return true;
}

function generateLicense() {
  return (
    "PHN-" +
    Math.random().toString(36).substring(2, 6).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 6).toUpperCase()
  );
}

app.get("/", (req, res) => {
  res.send("License Server Running");
});

app.post("/create-client", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { client_name } = req.body;

  const license = generateLicense();

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 5);

  db.run(
    `INSERT INTO clients (client_name, license_key, status, trial_end)
     VALUES (?, ?, ?, ?)`,
    [client_name, license, "trial", trialEnd.toISOString()],
    function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json({
        success: true,
        client_name,
        license_key: license,
        status: "trial",
        trial_end: trialEnd.toISOString()
      });
    }
  );
});

app.post(["/check-license", "/api/license/check", "/api/check-license"], (req, res) => {
  const licenseKey = req.body.license_key || req.body.licenseKey || req.body.key;
  const deviceId = req.body.device_id || req.body.deviceId;

  db.get(
    `SELECT * FROM clients WHERE license_key = ?`,
    [licenseKey],
    (err, row) => {
      if (err) {
        return res.status(500).json({
          valid: false,
          success: false,
          error: err.message
        });
      }

      if (!row) {
        return res.json({
          valid: false,
          success: false,
          message: "License not found"
        });
      }

      if (row.status === "suspended") {
        return res.json({
          valid: false,
          success: false,
          message: "Account suspended"
        });
      }

      // Check trial expiration
      if (row.status === "trial" && row.trial_end) {
        const now = new Date();
        const trialEnd = new Date(row.trial_end);

        if (now > trialEnd) {
          // Use a callback to handle the update properly
          db.run(
            `UPDATE clients SET status='suspended' WHERE license_key=?`,
            [licenseKey],
            function(updateErr) {
              if (updateErr) {
                console.error("Error updating trial expiration:", updateErr);
              }
              
              // Return response after update (or even if update fails)
              return res.json({
                valid: false,
                success: false,
                message: "Trial expired. Please contact support."
              });
            }
          );
          return; // Important: exit early to avoid double response
        }
      }

      // Handle device activation
      if (!row.device_id && deviceId) {
        db.run(
          `UPDATE clients SET device_id = ? WHERE license_key = ?`,
          [deviceId, licenseKey],
          function(updateErr) {
            if (updateErr) {
              console.error("Error updating device ID:", updateErr);
              return res.status(500).json({
                valid: false,
                success: false,
                error: "Failed to update device ID"
              });
            }

            return res.json({
              valid: true,
              success: true,
              message: "License activated",
              client_name: row.client_name,
              status: row.status
            });
          }
        );
        return;
      }

      // Check if license is already used on another device
      if (row.device_id && deviceId && row.device_id !== deviceId) {
        return res.json({
          valid: false,
          success: false,
          message: "License already used on another device"
        });
      }

      // License is valid
      return res.json({
        valid: true,
        success: true,
        message: "License valid",
        client_name: row.client_name,
        status: row.status,
        trial_end: row.trial_end
      });
    }
  );
});

app.post("/activate-client", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { license_key } = req.body;

  db.run(
    `UPDATE clients SET status='active' WHERE license_key=?`,
    [license_key],
    function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json({
        success: true,
        message: "Client activated"
      });
    }
  );
});

app.post("/suspend-client", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { license_key } = req.body;

  db.run(
    `UPDATE clients SET status='suspended' WHERE license_key=?`,
    [license_key],
    function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json({
        success: true,
        message: "Client suspended"
      });
    }
  );
});

app.post("/delete-client", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { license_key } = req.body;

  db.run(
    `DELETE FROM clients WHERE license_key=?`,
    [license_key],
    function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json({
        success: true,
        message: "Client deleted"
      });
    }
  );
});

app.get("/clients", (req, res) => {
  if (!checkAdmin(req, res)) return;
  db.all(
    `SELECT * FROM clients ORDER BY id DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({
          error: err.message
        });
      }

      res.json(rows);
    }
  );
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});