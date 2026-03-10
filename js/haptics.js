/* ==========================================
   LatentSearch — Haptic Feedback
   Uses web-haptics (navigator.vibrate) for mobile
   ========================================== */

import { WebHaptics } from '/node_modules/web-haptics/dist/index.mjs';

const haptics = new WebHaptics();

document.addEventListener('DOMContentLoaded', () => {
    // Search button → nudge (strong tap + soft tap)
    document.querySelectorAll('.search-btn').forEach(btn => {
        btn.addEventListener('click', () => haptics.trigger('nudge'), { capture: true });
    });

    // Lucky button → success (two quick taps)
    document.querySelectorAll('.lucky-btn').forEach(btn => {
        btn.addEventListener('click', () => haptics.trigger('success'), { capture: true });
    });

    // Camera button → light nudge
    document.querySelectorAll('.camera-btn').forEach(btn => {
        btn.addEventListener('click', () => haptics.trigger('nudge'), { capture: true });
    });

    // Clear button → short nudge
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => haptics.trigger('nudge'), { capture: true });
    }

    // Autocomplete suggestion → nudge
    document.addEventListener('click', (e) => {
        if (e.target.closest('.suggestion-item')) haptics.trigger('nudge');
    }, { capture: true });
});
