/* ==========================================
   LatentSearch — API Base Configuration
   ==========================================
   When deploying the frontend to Vercel (static hosting),
   set API_BASE to the URL of your separately-deployed Python backend.
   Leave empty ('') when running locally with server.py.

   Example backend hosts: Railway, Render, Fly.io
   ========================================== */

window.API_BASE = (() => {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return '';
    // Replace the string below with your backend URL, e.g.:
    // return 'https://latentsearch-api.railway.app';
    return '';
})();
