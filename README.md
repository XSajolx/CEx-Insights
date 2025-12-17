# CEx Insights - Intercom Chats Dashboard

A modern, dark-themed data visualization dashboard designed to analyze Intercom chat topics, trends, and regional distributions. Built with React and powered by Supabase.

## 🚀 Features

### 📊 Interactive Dashboards
1.  **Topic Distribution (Bar Chart):**
    *   Displays the total volume of chats per topic.
    *   **Logic:** Shows the top topics globally by default. Can be decoupled or filtered based on requirements.
    
2.  **Topic Trends Over Time (Area Chart):**
    *   Visualizes the daily volume of specific topics over a selected date range.
    *   **Comparison:** Supports comparing the "Current Period" vs. "Previous Period" (e.g., Last 7 Days vs. Previous 7 Days).
    *   **Data Labels:** values are displayed directly on the chart for easy reading.

3.  **Overall Breakdown (Donut Chart):**
    *   Shows the distribution of **Main Topics** (high-level categories like "Login_Issue", "KYC_Issue").
    *   **Dynamic View:** 
        *   Default: Shows top 15 Main Topics; smaller topics are grouped into "Other".
        *   Drill-down: Selecting a Main Topic updates this chart to show its constituent **Subtopics**.

### 🔍 Advanced Filtering
*   **Global Filters:** Date Range (Today, Yesterday, Last Week, etc.), Country, Region, Product.
*   **Main Topic Filter:** A dedicated dropdown to filter the dashboard by major categories.
    *   *Smart Filtering:* Automatically excludes low-frequency "noise" topics (count < 20) to keep the list clean.
    *   *Cascading:* Integrating the Main Topic filter updates the Trends Chart options and the Breakdown Chart view.

## 🛠️ Tech Stack

*   **Frontend Framework:** [React](https://reactjs.org/) (via [Vite](https://vitejs.dev/))
*   **Charting Library:** [Recharts](https://recharts.org/)
*   **Styling:** Custom CSS (Dark Theme, Glassmorphism effects)
*   **Icons:** Lucide React
*   **Data Source & Backend:** [Supabase](https://supabase.com/) (PostgreSQL)
*   **Deployment:** GitHub Actions -> GitHub Pages

## ⚙️ Setup & Installation

Follow these steps to run the project locally.

### 1. Prerequisites
*   Node.js (v16 or higher)
*   npm or yarn

### 2. Clone the Repository
```bash
git clone https://github.com/XSajolx/CEx-Insights.git
cd "Intercom Chats Dashboard"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
Create a `.env` file in the root directory and add your Supabase credentials:

```env
VITE_SUPABASE_URL=https://iktqpjwoahqycvlmstvx.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```
*(Note: Replace `YOUR_SUPABASE_ANON_KEY` with the actual key provided by your administrator.)*

### 5. Run Locally
Start the development server:
```bash
npm run dev
```
Open [http://localhost:5173/CEx-Insights/](http://localhost:5173/CEx-Insights/) to view the app.

## 📁 Project Structure

*   **`src/App.jsx`**: Main application entry point. Handles global state (filters, data fetching calls).
*   **`src/components/DashboardCharts.jsx`**: The core component containing all charts (Bar, Area, Pie) and their specific rendering logic.
*   **`src/services/api.js`**: Handles all interactions with Supabase (fetching topics, conversations, filtering main topics).
*   **`src/services/supabaseClient.js`**: Initializes the Supabase client connection.
*   **`.github/workflows/deploy.yml`**: CI/CD pipeline configuration for automatic deployment to GitHub Pages.

## 🚢 Deployment

The project is configured to deploy automatically to GitHub Pages when changes are pushed to the `main` branch.

**Build Command:**
```bash
npm run build
```

This generates a `dist` folder which is then served by GitHub Pages.
