# Vitthal Oil Mill OS — Remote Access & Sharing Guide

This guide explains how other staff members (Weighbridge cabins, Accountants, Owners) can open the dashboard from their own **phones, tablets, and computers**—both inside the mill and from home.

---

## 📶 Method 1: Local Access (Same Wi-Fi Network)
Use this method if the other devices are inside the mill and connected to the **same office Wi-Fi router** as the main server PC.

### Step 1: Find the Host PC's Local IP Address
1. Go to the main server PC.
2. Press `Win + R`, type **`cmd`**, and press Enter.
3. In the black window that opens, type the following and press Enter:
   ```text
   ipconfig
   ```
4. Look for the row named **IPv4 Address** under your active Wi-Fi or Ethernet adapter.
   *It will look like:* `192.168.1.15` (or `192.168.x.x`).

### Step 2: Open the link on other devices
1. Make sure the phone, tablet, or secondary laptop is connected to the **same Wi-Fi network**.
2. Open any web browser (Chrome, Safari, Edge) and go to:
   ```text
   http://<YOUR-HOST-IP>:4567
   ```
   *(For example: `http://192.168.1.15:4567`)*
3. **Success!** The dashboard will load. 

---

## 🌍 Method 2: Remote Access (From Home / Outside the Mill)
If the owner wants to check the dashboard from home, or if staff are on mobile data ($4\text{G}/5\text{G}$), you can connect the devices securely using **Tailscale** (a free, secure private network tool).

*This avoids exposing the mill's private database to hackers on the public internet.*

### Step 1: Set up Tailscale on the main server PC
1. Go to **[tailscale.com](https://tailscale.com/)** and sign up for a free account (using any Google/Microsoft account).
2. Download and install **Tailscale for Windows** on the main server PC.
3. Log in with your Tailscale account.
4. Once connected, Tailscale will assign a permanent private IP to the PC (it will look like `100.x.y.z`, for example: `100.82.112.45`).

### Step 2: Set up Tailscale on the other devices (Phones/Laptops)
1. Download the **Tailscale app** from the Apple App Store or Google Play Store (for phones), or download Tailscale for Windows/Mac (for laptops).
2. Log in using the **exact same account** you used in Step 1.
3. Turn Tailscale **On**.

### Step 3: Access the Dashboard from anywhere
1. Open the browser on your phone/laptop from home.
2. Go to the server PC's Tailscale IP address:
   ```text
   http://<SERVER-TAILSCALE-IP>:4567
   ```
   *(For example: `http://100.82.112.45:4567`)*
3. **Success!** You can now view, add, or edit ERP logs securely from anywhere in the world.

---

## 🔒 Security Reminder
Ensure you go to the **Database** tab -> **Roles & Access** and **Enable Access Control** so that remote users must enter their role PIN (e.g. Weighbridge `1111`, Supervisor `2222`, Accountant `3333`, Admin `4321`) to log entry transactions or view data.
