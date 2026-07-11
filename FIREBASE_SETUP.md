# Vitthal Oil Mill OS — Firebase Cloud Sync Setup Guide

Connecting the mill's ERP to **Firebase Realtime Database** enables **real-time cloud backup** and **multi-device synchronization** over the internet (outside the mill's local Wi-Fi).

If Firebase is not set up or offline, the app automatically falls back to offline mode using local storage (`database.json`), so the mill can keep working regardless.

---

## 🛠️ Step-by-Step Setup (Approx. 10 minutes)

### Step 1: Create a Free Firebase Project
1. Open your web browser and go to the **[Firebase Console](https://console.firebase.google.com/)**.
2. Log in with any Google/Gmail account.
3. Click **Add project** (or *Create a project*).
4. Name the project **`vitthal-oil-mill`** (or a name of your choice), accept the terms, and click **Continue**.
5. *Google Analytics*: You can safely turn this **Off** (not needed for ERP operations), then click **Create project**.
6. Wait a few seconds for the project to provision, then click **Continue**.

---

### Step 2: Create the Realtime Database
1. In the left-hand sidebar, click on **Build** and select **Realtime Database**.
2. Click the **Create database** button.
3. **Database location**: Choose the region closest to the mill (for example, select **Singapore (asia-southeast1)** or **India (asia-south1)** if available) for maximum speed. Click **Next**.
4. **Security rules**: Start in **Locked mode** (click **Enable**). 
   *Note: Because our server connects using a private administrator service key, it automatically bypasses database locks. Your database remains 100% secure from public internet snooping.*
5. Copy the **Database URL** that appears at the top of your database screen. It will look like this:
   `https://your-project-id-default-rtdb.asia-south1.firebasedatabase.app/`

---

### Step 3: Download the Private Service Key File
To allow the server to securely write logs to the cloud database, download a private credential key file:
1. Click the **Gear Icon ⚙️** (Project Settings) at the top of the left-hand sidebar, and select **Project settings**.
2. Click the **Service accounts** tab at the top of the settings page.
3. Select **Python** as the platform config choice.
4. Click the **Generate new private key** button at the bottom of the page.
5. A download window will pop up. Save the `.json` file to your computer.

---

### Step 4: Configure the ERP Files
Now, configure the downloaded parameters inside the **`vittal oil mill`** folder:
1. Locate the downloaded credentials file (it will have a long name like `vitthal-oil-mill-firebase-adminsdk-xxxx.json`).
2. Move this file into the **`vittal oil mill`** project folder and rename it to exactly **`firebase-service-key.json`** (replacing the placeholder file).
3. Open the file named **`firebase-config.json`** in a text editor (like Notepad) and replace the placeholder database URL with the one you copied in Step 2:
   ```json
   {
     "databaseURL": "https://your-project-id-default-rtdb.asia-south1.firebasedatabase.app/"
   }
   ```
4. Save and close `firebase-config.json`.

---

### Step 5: Install Python Dependencies
For the server to connect to Firebase, install the official Firebase Python library:
1. Open your command prompt (press `Win + R`, type `cmd`, and press Enter).
2. Run the following command:
   ```bash
   pip install firebase-admin
   ```
3. Wait for the installation to finish (it will show a message like *Successfully installed firebase-admin*).

---

### Step 6: Launch & Verify Sync
1. Double-click **`Launch ERP.bat`** (or run `python server.py`).
2. In the command prompt window that launches, look for the confirmation message:
   ```text
   [Firebase] Connected & Active: https://your-project-id...
   [Firebase] Successfully pulled latest database from cloud.
   ```
3. Open the app in your browser (**http://localhost:4567**).
4. Look at the top right of the dashboard: the sync status badge will display a green cloud icon and read **`Sync Active`** instead of *Local Storage Mode*.

---

## 🔒 Security Best Practices
> [!CAUTION]
> The **`firebase-service-key.json`** file contains highly sensitive keys that grant full read/write admin access to your cloud database. **Do not share this file** or commit it to public code repositories like GitHub. Keep this file locally on the mill's host server PC.
