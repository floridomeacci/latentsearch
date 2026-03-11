/* ==========================================
   LatentSearch — Core JS (shared)
   ========================================== */

const I18N = {
    en: {
        placeholder: 'Search',
        searchBtn: 'Search',
        luckyBtn: "I'm Feeling Lucky",
        offeredIn: 'LatentSearch offered in:',
        footerCountry: 'United States',
        footerAbout: 'About',
        footerAdvertising: 'Advertising',
        footerBusiness: 'Business',
        footerHowSearch: 'How Search works',
        footerPrivacy: 'Privacy',
        footerTerms: 'Terms',
        footerSettings: 'Settings',
    },
    es: {
        placeholder: 'Buscar',
        searchBtn: 'Buscar',
        luckyBtn: 'Me siento con suerte',
        offeredIn: 'LatentSearch en:',
        footerCountry: 'Estados Unidos',
        footerAbout: 'Acerca de',
        footerAdvertising: 'Publicidad',
        footerBusiness: 'Empresas',
        footerHowSearch: 'Cómo funciona la Búsqueda',
        footerPrivacy: 'Privacidad',
        footerTerms: 'Términos',
        footerSettings: 'Configuración',
    },
    fr: {
        placeholder: 'Rechercher',
        searchBtn: 'Rechercher',
        luckyBtn: "J'ai de la chance",
        offeredIn: 'LatentSearch en\u00a0:',
        footerCountry: 'États-Unis',
        footerAbout: 'À propos',
        footerAdvertising: 'Publicité',
        footerBusiness: 'Entreprises',
        footerHowSearch: 'Comment fonctionne la recherche',
        footerPrivacy: 'Confidentialité',
        footerTerms: 'Conditions',
        footerSettings: 'Paramètres',
    },
    de: {
        placeholder: 'Suchen',
        searchBtn: 'Suchen',
        luckyBtn: 'Auf gut Glück!',
        offeredIn: 'LatentSearch auf:',
        footerCountry: 'USA',
        footerAbout: 'Über uns',
        footerAdvertising: 'Werbung',
        footerBusiness: 'Unternehmen',
        footerHowSearch: 'Wie die Suche funktioniert',
        footerPrivacy: 'Datenschutz',
        footerTerms: 'Nutzungsbedingungen',
        footerSettings: 'Einstellungen',
    },
    ja: {
        placeholder: '検索',
        searchBtn: '検索',
        luckyBtn: '気まぐれに！',
        offeredIn: 'LatentSearch を以下の言語で:',
        footerCountry: '日本',
        footerAbout: 'LatentSearch について',
        footerAdvertising: '広告掲載',
        footerBusiness: 'ビジネス',
        footerHowSearch: '検索の仕組み',
        footerPrivacy: 'プライバシー',
        footerTerms: '規約',
        footerSettings: '設定',
    },
};

function applyLanguage(hl) {
    const strings = I18N[hl] || I18N.en;
    document.documentElement.lang = hl;

    // Translate data-i18n text nodes
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (strings[key] !== undefined) el.textContent = strings[key];
    });

    // Translate placeholders
    document.querySelectorAll('.search-input').forEach(el => {
        el.placeholder = strings.placeholder || 'Search';
        el.title = strings.placeholder || 'Search';
        el.setAttribute('aria-label', strings.placeholder || 'Search');
    });

    // Highlight active language link
    document.querySelectorAll('.lang-link').forEach(a => {
        a.style.fontWeight = a.dataset.lang === hl ? 'bold' : '';
        a.style.textDecoration = a.dataset.lang === hl ? 'underline' : '';
    });
}

document.addEventListener('DOMContentLoaded', () => {

    // === Autocomplete suggestions (mock) ===
    const popularSearches = [
        'latentsearch', 'weather today', 'news', 'translate',
        'maps', 'youtube', 'gmail', 'how to',
        'stock market', 'sports scores', 'recipes',
        'calculator', 'unit converter', 'time zones',
        'movies near me', 'flights', 'hotels',
        'restaurants near me', 'gas prices', 'traffic'
    ];

    function setupAutocomplete(inputEl, boxEl) {
        if (!inputEl || !boxEl) return;

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'suggestions-dropdown';
        boxEl.appendChild(dropdown);

        inputEl.addEventListener('input', () => {
            const val = inputEl.value.trim().toLowerCase();
            if (!val) {
                dropdown.style.display = 'none';
                boxEl.classList.remove('has-suggestions');
                return;
            }
            const matches = popularSearches
                .filter(s => s.includes(val))
                .slice(0, 8);

            if (matches.length === 0) {
                dropdown.style.display = 'none';
                boxEl.classList.remove('has-suggestions');
                return;
            }

            dropdown.innerHTML = matches.map(s => `
                <div class="suggestion-item" data-query="${s}">
                    <span class="suggestion-icon">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        </svg>
                    </span>
                    <span>${highlightMatch(s, val)}</span>
                </div>
            `).join('');

            dropdown.style.display = 'block';
            boxEl.classList.add('has-suggestions');

            dropdown.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    inputEl.value = item.dataset.query;
                    dropdown.style.display = 'none';
                    boxEl.classList.remove('has-suggestions');
                    inputEl.closest('form').submit();
                });
            });
        });

        inputEl.addEventListener('focus', () => {
            if (inputEl.value.trim()) {
                inputEl.dispatchEvent(new Event('input'));
            }
        });

        document.addEventListener('click', (e) => {
            if (!boxEl.contains(e.target)) {
                dropdown.style.display = 'none';
                boxEl.classList.remove('has-suggestions');
            }
        });
    }

    function highlightMatch(text, query) {
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        return text.slice(0, idx) + '<b>' + text.slice(idx, idx + query.length) + '</b>' + text.slice(idx + query.length);
    }

    function getContainerInput(buttonEl) {
        const container = buttonEl.closest('.search-container');
        if (!container) return null;
        return container.querySelector('.search-input');
    }

    function getContainerForm(buttonEl) {
        const container = buttonEl.closest('.search-container');
        if (!container) return null;
        return container.querySelector('form');
    }

    const luckyQueries = [
        'Dead Internet Theory',
        'are any humans still using the internet',
        'how to tell if a news article was written by a person',
        'is this review real or AI generated',
        'percentage of internet traffic that is bots',
        'did AI write this',
        'what was the internet like before LLMs',
        'signs you are talking to a chatbot',
        'AI slop explained',
        'who is actually on social media anymore',
        'can Google still find real information',
        'everything online is fake now',
        'authenticity on the internet 2025',
        'how to find human-written content',
        'post-truth internet era',
        'is Wikipedia still written by humans',
        'AI generated reviews problem',
        'synthetic media takeover',
        'are influencers real people',
        'when did the internet die',
    ];

    async function handleLuckyClick(buttonEl) {
        const inputEl = getContainerInput(buttonEl) || document.querySelector('.search-input');
        if (!inputEl) return;
        const typed = inputEl.value.trim();
        const query = typed || luckyQueries[Math.floor(Math.random() * luckyQueries.length)];
        if (inputEl && !typed) inputEl.value = query;
        window.location.href = `search.html?q=${encodeURIComponent(query)}&lucky=1`;
    }

    function setupVoiceButton(buttonEl) {
        buttonEl.addEventListener('click', () => {
            const inputEl = getContainerInput(buttonEl);
            if (!inputEl) return;

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                alert('Voice search is not supported in this browser.');
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.lang = 'en-US';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            recognition.onresult = (event) => {
                const transcript = event.results?.[0]?.[0]?.transcript || '';
                inputEl.value = transcript;
                inputEl.dispatchEvent(new Event('input'));
                inputEl.focus();
            };

            recognition.start();
        });
    }

    function setupCameraButton(buttonEl) {
        buttonEl.addEventListener('click', () => {
            const inputEl = getContainerInput(buttonEl);
            const query = inputEl ? inputEl.value.trim() : '';
            const url = `search.html?q=${encodeURIComponent(query)}&tbm=isch`;
            window.location.href = url;
        });
    }

    // Setup autocomplete for home page
    const homeInput = document.querySelector('.home-page .search-input');
    const homeBox = document.querySelector('.home-page .search-box');
    setupAutocomplete(homeInput, homeBox);

    // Setup autocomplete for results page
    const resultInput = document.getElementById('results-search-input');
    const resultBox = document.querySelector('.results-search-box');
    setupAutocomplete(resultInput, resultBox);

    // Clear button on results page
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn && resultInput) {
        resultInput.addEventListener('input', () => {
            clearBtn.style.display = resultInput.value ? 'flex' : 'none';
        });
        clearBtn.addEventListener('click', () => {
            resultInput.value = '';
            resultInput.focus();
            clearBtn.style.display = 'none';
        });
    }

    document.querySelectorAll('.lucky-btn').forEach(btn => {
        btn.addEventListener('click', () => handleLuckyClick(btn));
    });

    document.querySelectorAll('.voice-btn').forEach(setupVoiceButton);
    document.querySelectorAll('.camera-btn').forEach(setupCameraButton);

    // Language links
    document.querySelectorAll('.lang-link').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const hl = a.dataset.lang || 'en';
            localStorage.setItem('hl', hl);
            applyLanguage(hl);
        });
    });

    // Apply stored language on every page load
    const storedHl = localStorage.getItem('hl') || 'en';
    applyLanguage(storedHl);
});
