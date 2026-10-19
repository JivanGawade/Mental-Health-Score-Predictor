# MindMetric AI 🧠

MindMetric AI is an educational machine learning project that estimates a student's mental health score based on their lifestyle, academic workload, and social media usage patterns. 

It features a machine learning model trained on student behavior data, served via a **FastAPI** backend, and consumed by a responsive, vanilla **JavaScript/HTML/CSS** frontend.

## 🚀 Live Demo
* **Application:** (https://mental-health-score-predictor-1-78k3.onrender.com/)

## ⚡ Features
* **Machine Learning Prediction:** Uses a Random Forest Regressor to analyze 12 different lifestyle and demographic variables.
* **FastAPI Backend:** A lightweight, high-performance REST API with built-in Pydantic validation.
* **Interactive Frontend:** A sleek, guided user interface with live form validation and an animated score gauge.
* **CORS Enabled:** Fully decoupled architecture allowing the frontend and backend to be hosted on separate platforms.

## 🛠️ Tech Stack
* **Backend:** Python, FastAPI, Uvicorn, Pydantic
* **Machine Learning:** Scikit-Learn, Pandas, Numpy, Joblib
* **Frontend:** HTML5, CSS3, Vanilla JavaScript
* **Deployment:** GitHub Pages (Frontend), Render (Backend API)

## 📂 Project Structure
* `main.py` — The FastAPI application and prediction endpoint.
* `ML_pro.ipynb` & `ML_pro_2.ipynb` — Jupyter Notebooks containing data exploration, preprocessing, and model training.
* `MENTAL_HEALTH_SCORE_MODEL.pkl` — The exported Random Forest model.
* `index.html` — The main UI for the application.
* `style.css` — Styling and animations for the frontend.
* `script.js` — Form handling, validation, and API fetch logic.
* `requirements.txt` — Python dependencies required to run the server.
