/* ==========================================
   LatentSearch — Search Results JS
   Uses Replicate API via backend proxy
   ========================================== */

let currentPage = 1;
let currentQuery = '';
let isImageMode = false;
let isLucky = false;
const CACHE_PREFIX = 'latentsearch:v3';

function triggerLucky() {
    setTimeout(() => {
        const first = document.querySelector('.result-link');
        if (first) first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, 400);
}

// Robust API POST helper: try configured API_BASE first, then fall back to same-origin path
async function apiPost(path, body) {
    const primary = (window.API_BASE || '') + path;
    try {
        const resp = await fetch(primary, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return resp;
    } catch (err) {
        // Primary failed (network/CORS) — retry same-origin
        try {
            const resp2 = await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return resp2;
        } catch (err2) {
            // rethrow original error for visibility
            err2.original = err;
            throw err2;
        }
    }
}

function makeCacheKey(kind, query, page) {
    return `${CACHE_PREFIX}:${kind}:${(query || '').trim().toLowerCase()}:${page}`;
}

function readCache(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (_err) {
        return null;
    }
}

function writeCache(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify({ ...value, _ts: Date.now() }));
    } catch (_err) {
        // ignore storage failures
    }
}

function mergeUniqueImages(primaryImages, extraImages) {
    const merged = [];
    const seen = new Set();

    [...(primaryImages || []), ...(extraImages || [])].forEach(img => {
        const key = `${img?.url || ''}|${img?.title || ''}`;
        if (!img || !img.url || seen.has(key)) return;
        seen.add(key);
        merged.push(img);
    });

    return merged;
}

function seedImagesCacheFromHighlights(query, highlights) {
    if (!Array.isArray(highlights) || highlights.length === 0) return;

    const imagesKey = makeCacheKey('images-view', query, 1);
    const existing = readCache(imagesKey);
    const merged = mergeUniqueImages(highlights, existing?.images || []);

    writeCache(imagesKey, {
        images: merged,
        nextPage: existing?.nextPage || 1,
        seededFromHighlights: merged.length < 8,
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentQuery = params.get('q') || '';
    isImageMode = params.get('tbm') === 'isch';
    isLucky = params.get('lucky') === '1';
    currentPage = parseInt(params.get('page') || '1', 10);

    const searchInput = document.getElementById('results-search-input');
    const clearBtn = document.getElementById('clear-btn');

    // Fill search box
    if (searchInput && currentQuery) {
        searchInput.value = currentQuery;
        if (clearBtn) clearBtn.style.display = 'flex';
    }

    // Update page title
    document.title = currentQuery
        ? `${currentQuery} - LatentSearch ${isImageMode ? 'Images' : 'Search'}`
        : 'LatentSearch';

    if (isImageMode) {
        showImageResults(currentQuery, currentPage);
    } else {
        showWebResults(currentQuery, currentPage);
    }

    // Setup pagination clicks
    setupPagination();
});

// ==========================================
// SWITCH TO IMAGES
// ==========================================
function switchToImages(e) {
    e.preventDefault();
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q') || '';
    window.location.href = `search.html?q=${encodeURIComponent(query)}&tbm=isch`;
}

// ==========================================
// WEB RESULTS
// ==========================================
async function showWebResults(query, page) {
    const resultsMain = document.getElementById('results-main');
    const imagesMain = document.getElementById('images-main');
    if (resultsMain) resultsMain.style.display = 'block';
    if (imagesMain) imagesMain.style.display = 'none';

    // Activate "All" nav
    const navAll = document.getElementById('nav-all');
    const navImages = document.getElementById('nav-images');
    if (navAll) navAll.classList.add('active');
    if (navImages) {
        navImages.classList.remove('active');
        navImages.href = `search.html?q=${encodeURIComponent(query)}&tbm=isch`;
        navImages.onclick = null;
    }

    const statsEl = document.getElementById('results-stats');
    const resultsEl = document.getElementById('search-results');
    const highlightsContainerId = 'image-highlights-container';
    const cacheKey = makeCacheKey('web', query, page);

    let highlightsContainer = document.getElementById(highlightsContainerId);
    if (!highlightsContainer && resultsEl && resultsEl.parentElement) {
        highlightsContainer = document.createElement('div');
        highlightsContainer.id = highlightsContainerId;
        resultsEl.parentElement.insertBefore(highlightsContainer, resultsEl);
    }

    if (!query) {
        if (statsEl) statsEl.textContent = '';
        if (highlightsContainer) highlightsContainer.innerHTML = '';
        if (resultsEl) resultsEl.innerHTML = '<p style="color:#70757a;padding:20px 0;">Enter a search query to see results.</p>';
        return;
    }

    const cachedWeb = readCache(cacheKey);
    if (cachedWeb && Array.isArray(cachedWeb.results) && cachedWeb.results.length) {
        if (statsEl) statsEl.textContent = cachedWeb.statsText || '';
        if (resultsEl) {
            resultsEl.innerHTML = renderWebResultsHtml(cachedWeb.results);
        }
        renderImageHighlights(query, highlightsContainer, cachedWeb.imageHighlights || []);
        updatePagination(page);
        if (isLucky) triggerLucky();
        return;
    }

    // Show loading skeleton
    if (highlightsContainer) highlightsContainer.innerHTML = '';
    if (resultsEl) {
        resultsEl.innerHTML = Array(6).fill('').map(() => `
            <div class="result-item">
                <div class="result-url-row">
                    <div class="result-favicon skeleton-shimmer" style="width:28px;height:28px;border-radius:50%;"></div>
                    <div class="result-site-info">
                        <div class="skeleton-text skeleton-shimmer" style="width:120px;height:14px;"></div>
                        <div class="skeleton-text skeleton-shimmer" style="width:200px;height:12px;margin-top:4px;"></div>
                    </div>
                </div>
                <div class="skeleton-text skeleton-shimmer" style="width:80%;height:20px;margin:8px 0 4px;"></div>
                <div class="skeleton-text skeleton-shimmer" style="width:100%;height:14px;margin:4px 0;"></div>
                <div class="skeleton-text skeleton-shimmer" style="width:90%;height:14px;"></div>
            </div>
        `).join('');
    }

    // Loading status ticker
    const loadingMessages = [
        'Searching the depths of the internet…',
        'Consulting extremely reliable sources…',
        'Cross-referencing with the literature…',
        'Retrieving information from the web…',
        'Sifting through billions of pages…',
        'Finding the most relevant results…',
        'Indexing real human-written content…',
        'Scanning for authoritative sources…',
        'Compiling results from across the web…',
        'Verifying facts with trusted sources…',
        'Searching… this might take a moment…',
        'Still searching, please hold…',
        'Results are on their way…',
        'Almost there, we promise…',
        'Worth the wait, probably…',
    ];
    let msgIndex = 0;
    const startTime = performance.now();
    const updateStatus = () => {
        const secs = Math.floor((performance.now() - startTime) / 1000);
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        const timeStr = mins > 0 ? `${mins}m ${s}s` : `${s}s`;
        if (statsEl) statsEl.innerHTML =
            `<span class="loading-status-msg">${loadingMessages[msgIndex % loadingMessages.length]}</span>` +
            `<span class="loading-status-timer">${timeStr}</span>`;
        msgIndex++;
    };
    updateStatus();
    const loadingInterval = setInterval(updateStatus, 3000);

    try {
        const response = await apiPost('/api/search', { query, page });
        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (parseErr) {
            throw new Error('Invalid JSON response from server');
        }
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        if (!response.ok) {
            clearInterval(loadingInterval);
            const serverError = (data && data.error) ? data.error : `Request failed (${response.status})`;
            if (resultsEl) {
                resultsEl.innerHTML = `<p style="color:#ea4335;padding:20px 0;">Error: ${escapeHtml(serverError)}</p>`;
            }
            if (statsEl) statsEl.textContent = '';
            return;
        }

        if (data.error) {
            clearInterval(loadingInterval);
            if (resultsEl) {
                resultsEl.innerHTML = `<p style="color:#ea4335;padding:20px 0;">Error: ${escapeHtml(data.error)}</p>`;
            }
            if (statsEl) statsEl.textContent = '';
            return;
        }

        const results = normalizeSearchResults(data);
        const imageHighlights = Array.isArray(data.imageHighlights) ? data.imageHighlights.slice(0, 3) : [];

        if (!Array.isArray(results) || results.length === 0) {
            clearInterval(loadingInterval);
            if (statsEl) statsEl.textContent = '';
            if (resultsEl) {
                resultsEl.innerHTML = '<p style="color:#70757a;padding:20px 0;">No results found.</p>';
            }
            updatePagination(page);
            return;
        }

        if (highlightsContainer) {
            renderImageHighlights(query, highlightsContainer, imageHighlights);
        }

        const resultCount = (Math.floor(Math.random() * 900) + 100) * 1000000;
        const statsText = `About ${resultCount.toLocaleString()} results (${elapsed} seconds)`;

        clearInterval(loadingInterval);
        if (statsEl) {
            statsEl.textContent = statsText;
        }

        if (resultsEl) {
            resultsEl.innerHTML = renderWebResultsHtml(results);
        }

        // Update pagination
        updatePagination(page);
        if (isLucky) triggerLucky();

        renderImageHighlights(query, highlightsContainer, imageHighlights);
        seedImagesCacheFromHighlights(query, imageHighlights);
        writeCache(cacheKey, { results, imageHighlights, statsText });

    } catch (err) {
        clearInterval(loadingInterval);
        if (statsEl) statsEl.textContent = '';
        console.error('Search error:', err);
        if (resultsEl) {
            resultsEl.innerHTML = `<p style="color:#ea4335;padding:20px 0;">Failed to fetch results. Is the server running?</p>`;
        }
    }
}

function renderImageHighlights(query, containerEl, images) {
    if (!containerEl) return;
    if (!Array.isArray(images) || !images.length) {
        containerEl.innerHTML = '';
        return;
    }
    // Feed pool
    images.forEach(img => { if (img.url && !imagePool.includes(img.url)) imagePool.push(img.url); });

    containerEl.innerHTML = `
        <div class="image-highlights-card">
            <div class="image-highlights-header">
                <div class="image-highlights-title">Images</div>
                <a class="image-highlights-link" href="search.html?q=${encodeURIComponent(query)}&tbm=isch">More images</a>
            </div>
            <div class="image-highlights-grid">
                ${images.slice(0, 3).map(img => `
                    <a class="image-highlights-item" href="search.html?q=${encodeURIComponent(query)}&tbm=isch">
                        <img class="image-highlights-thumb" src="${img.url}" alt="${escapeHtml(img.title || query)}" loading="lazy"
                             onerror="this.style.background='#f1f3f4';this.alt='Failed to load';">
                    </a>
                `).join('')}
            </div>
        </div>
    `;
}

// ==========================================
// IMAGE RESULTS
// ==========================================
async function showImageResults(query, page) {
    const resultsMain = document.getElementById('results-main');
    const imagesMain = document.getElementById('images-main');
    if (resultsMain) resultsMain.style.display = 'none';
    if (imagesMain) imagesMain.style.display = 'block';

    // Activate "Images" nav
    const navAll = document.getElementById('nav-all');
    const navImages = document.getElementById('nav-images');
    if (navAll) {
        navAll.classList.remove('active');
        navAll.href = `search.html?q=${encodeURIComponent(query)}`;
    }
    if (navImages) {
        navImages.classList.add('active');
        navImages.onclick = null;
    }

    document.title = query ? `${query} - LatentSearch Images` : 'LatentSearch Images';

    const imageResultsEl = document.getElementById('image-results');
    const viewCacheKey = makeCacheKey('images-view', query, page);
    if (!query) {
        imageResultsEl.innerHTML = '<p style="color:#70757a;padding:20px 0;">Enter a search query to see image results.</p>';
        return;
    }

    // Filter chips + loading skeletons
    const filters = ['All', 'Large', 'Medium', 'HD', 'Artistic', 'Photo', 'Illustration', 'Recent'];

    imageResultsEl.innerHTML = `
        <div class="image-filters">
            ${filters.map((f, i) => `<button class="filter-chip${i === 0 ? ' active' : ''}">${f}</button>`).join('')}
        </div>
        <div class="image-results-grid" id="image-grid">
            ${Array(8).fill('').map(() => `
                <div class="image-card loading-card">
                    <div class="image-thumb skeleton-shimmer"></div>
                    <div class="image-card-info">
                        <div class="skeleton-text skeleton-shimmer"></div>
                        <div class="skeleton-text short skeleton-shimmer"></div>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="load-more-container" id="load-more-container" style="display:none;">
            <button class="load-more-btn" id="load-more-btn">Show more results</button>
        </div>
    `;

    // Setup filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });

    const grid = document.getElementById('image-grid');
    const loadMoreContainer = document.getElementById('load-more-container');
    const loadMoreBtn = document.getElementById('load-more-btn');

    // Lightbox state
    let lightboxImages = [];

    function renderImageCard(img, searchQuery, idx) {
        return `
            <div class="image-card" data-img-idx="${idx ?? ''}">
                <img class="image-thumb" src="${img.url}" alt="${escapeHtml(img.title || searchQuery)}" loading="lazy"
                     onerror="this.style.background='#f1f3f4';this.alt='Failed to load';">
                <div class="image-card-info">
                    <div class="image-card-title">${escapeHtml(img.title || searchQuery)}</div>
                    <div class="image-card-source">
                        <div class="image-card-source-icon"></div>
                        AI Generated
                    </div>
                </div>
            </div>
        `;
    }

    // Inject the single lightbox backdrop into the page (once)
    let lightboxEl = document.getElementById('img-lightbox-backdrop');
    if (!lightboxEl) {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="img-lightbox-backdrop" id="img-lightbox-backdrop" role="dialog" aria-modal="true">
                <button class="img-lightbox-close" id="img-lb-close" aria-label="Close">&#x2715;</button>
                <button class="img-lightbox-arrow prev" id="img-lb-prev" aria-label="Previous">&#x2039;</button>
                <div class="img-lightbox-panel" id="img-lb-panel">
                    <div class="img-lightbox-img-wrap">
                        <img id="img-lb-img" src="" alt="">
                    </div>
                    <div class="img-lightbox-info">
                        <div class="img-lightbox-meta">
                            <div class="img-lightbox-title" id="img-lb-title"></div>
                            <div class="img-lightbox-source">AI Generated &middot; LatentSearch</div>
                        </div>
                        <div class="img-lightbox-actions">
                            <a class="img-lightbox-btn" id="img-lb-open" href="#" target="_blank" rel="noopener">View image</a>
                        </div>
                    </div>
                </div>
                <button class="img-lightbox-arrow next" id="img-lb-next" aria-label="Next">&#x203a;</button>
            </div>
        `);
        lightboxEl = document.getElementById('img-lightbox-backdrop');
    }

    let currentLbIdx = 0;

    function openLightbox(idx) {
        currentLbIdx = Math.max(0, Math.min(idx, lightboxImages.length - 1));
        const img = lightboxImages[currentLbIdx];
        if (!img) return;
        document.getElementById('img-lb-img').src = img.url;
        document.getElementById('img-lb-img').alt = img.title || query;
        document.getElementById('img-lb-title').textContent = img.title || query;
        document.getElementById('img-lb-open').href = img.url;
        lightboxEl.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightboxEl.classList.remove('open');
        document.body.style.overflow = '';
    }

    document.getElementById('img-lb-close').onclick = closeLightbox;
    document.getElementById('img-lb-prev').onclick = (e) => { e.stopPropagation(); openLightbox(currentLbIdx - 1); };
    document.getElementById('img-lb-next').onclick = (e) => { e.stopPropagation(); openLightbox(currentLbIdx + 1); };
    lightboxEl.onclick = (e) => { if (e.target === lightboxEl) closeLightbox(); };

    const _kHandler = (e) => {
        if (!lightboxEl.classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') openLightbox(currentLbIdx - 1);
        if (e.key === 'ArrowRight') openLightbox(currentLbIdx + 1);
    };
    document.removeEventListener('keydown', window.__lbKeyHandler);
    window.__lbKeyHandler = _kHandler;
    document.addEventListener('keydown', _kHandler);

    // Click delegation on grid
    grid.addEventListener('click', (e) => {
        const card = e.target.closest('.image-card[data-img-idx]');
        if (!card) return;
        const idx = parseInt(card.dataset.imgIdx, 10);
        if (!isNaN(idx)) openLightbox(idx);
    });

    function renderLoadingImageCards(count) {
        return Array(count).fill('').map(() => `
            <div class="image-card loading-card">
                <div class="image-thumb skeleton-shimmer"></div>
                <div class="image-card-info">
                    <div class="skeleton-text skeleton-shimmer"></div>
                    <div class="skeleton-text short skeleton-shimmer"></div>
                </div>
            </div>
        `).join('');
    }

    /**
     * Open an SSE stream to /api/images/stream and replace skeleton cards
     * one-by-one as each image arrives.
     * @param {number} streamPage - which page to request
     * @param {number} streamCount - how many images
     * @param {Element[]} skeletonEls - existing skeleton DOM nodes to replace in order
     * @param {function} onImage - called with each image object as it arrives
     * @param {function} onDone - called when stream closes cleanly
     */
    function streamImages(streamPage, streamCount, skeletonEls, onImage, onDone) {
        const params = new URLSearchParams({ query, page: streamPage, count: streamCount });
        // Try EventSource to configured API_BASE first; if it errors, fallback to a POST polling
        let es;
        try {
            es = new EventSource((window.API_BASE || '') + `/api/images/stream?${params}`);
        } catch (e) {
            // EventSource construction can throw in some environments — fall back below
            es = null;
        }
        let localIdx = 0;

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.done) {
                    es.close();
                    onDone();
                    return;
                }
                const lbIdx = lightboxImages.length;
                lightboxImages.push(data);
                // Feed shared pool
                if (data.url && !imagePool.includes(data.url)) imagePool.push(data.url);
                const card = document.createElement('div');
                card.innerHTML = renderImageCard(data, query, lbIdx);
                const realCard = card.firstElementChild;
                if (localIdx < skeletonEls.length) {
                    skeletonEls[localIdx].replaceWith(realCard);
                } else {
                    grid.appendChild(realCard);
                }
                localIdx++;
                onImage(data);
            } catch (_e) { /* ignore parse errors */ }
        };

        es.onerror = async () => {
            try { if (es) es.close(); } catch (_) {}
            // Remove remaining skeletons
            skeletonEls.slice(localIdx).forEach(s => s.remove());
            // Fallback: try POST /api/images to retrieve a batch
            try {
                const resp = await apiPost('/api/images', { query, page: streamPage, count: streamCount });
                const text = await resp.text();
                const data = JSON.parse(text || '{}');
                const images = Array.isArray(data.images) ? data.images : [];
                images.forEach(img => {
                    const lbIdx = lightboxImages.length;
                    lightboxImages.push(img);
                    if (img.url && !imagePool.includes(img.url)) imagePool.push(img.url);
                    const card = document.createElement('div');
                    card.innerHTML = renderImageCard(img, query, lbIdx);
                    const realCard = card.firstElementChild;
                    grid.appendChild(realCard);
                    onImage(img);
                });
            } catch (_e) {
                // ignore, we'll just finish
            }
            onDone();
        };

        return es;
    }

    function setupLoadMore(nextStartPage, currentImages) {
        if (!loadMoreContainer || !loadMoreBtn) return;
        loadMoreContainer.style.display = 'flex';

        let nextPage = nextStartPage;
        let allImages = Array.isArray(currentImages) ? [...currentImages] : [];

        loadMoreBtn.onclick = () => {
            loadMoreBtn.textContent = 'Loading...';
            loadMoreBtn.disabled = true;

            const skeletonHtml = renderLoadingImageCards(8);
            const wrapper = document.createElement('div');
            wrapper.innerHTML = skeletonHtml;
            const skeletonEls = Array.from(wrapper.children);
            skeletonEls.forEach(s => grid.appendChild(s));

            const newImages = [];

            streamImages(
                nextPage, 8, skeletonEls,
                (img) => { newImages.push(img); allImages.push(img); },
                () => {
                    nextPage++;
                    writeCache(viewCacheKey, { images: allImages, nextPage });
                    loadMoreBtn.textContent = newImages.length ? 'Show more results' : 'No more results';
                    loadMoreBtn.disabled = false;
                }
            );
        };
    }

    // ---- Seed from highlights if no images cache yet ----
    let cachedImagesView = readCache(viewCacheKey);

    if ((!cachedImagesView || !Array.isArray(cachedImagesView.images) || !cachedImagesView.images.length) && page === 1) {
        const cachedWeb = readCache(makeCacheKey('web', query, 1));
        if (cachedWeb && Array.isArray(cachedWeb.imageHighlights) && cachedWeb.imageHighlights.length) {
            seedImagesCacheFromHighlights(query, cachedWeb.imageHighlights);
            cachedImagesView = readCache(viewCacheKey);
        }
    }

    // ---- Render from cache ----
    if (cachedImagesView && Array.isArray(cachedImagesView.images) && cachedImagesView.images.length) {
        lightboxImages = [...cachedImagesView.images];
        grid.innerHTML = lightboxImages.map((img, i) => renderImageCard(img, query, i)).join('');

        if (cachedImagesView.seededFromHighlights && page === 1) {
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';

            // Add skeleton slots for the upcoming 8 images
            const skeletonHtml = renderLoadingImageCards(8);
            const wrapper = document.createElement('div');
            wrapper.innerHTML = skeletonHtml;
            const skeletonEls = Array.from(wrapper.children);
            skeletonEls.forEach(s => grid.appendChild(s));

            const seededImages = [...cachedImagesView.images];
            const fetchedImages = [];

            streamImages(
                1, 8, skeletonEls,
                (img) => fetchedImages.push(img),
                () => {
                    const merged = mergeUniqueImages(seededImages, fetchedImages);
                    writeCache(viewCacheKey, { images: merged, nextPage: 2, seededFromHighlights: false });
                    setupLoadMore(2, merged);
                }
            );

            return;
        }

        setupLoadMore(cachedImagesView.nextPage || page + 1, cachedImagesView.images);
        return;
    }

    // ---- Fresh load: show skeletons then stream ----
    const skeletonEls = Array.from(grid.querySelectorAll('.loading-card'));
    const collectedImages = [];

    streamImages(
        page, 8, skeletonEls,
        (img) => collectedImages.push(img),
        () => {
            if (!collectedImages.length) {
                grid.innerHTML = `<p style="color:#ea4335;padding:20px 0;">Failed to generate images. Is the server running?</p>`;
                return;
            }
            writeCache(viewCacheKey, { images: collectedImages, nextPage: page + 1 });
            setupLoadMore(page + 1, collectedImages);
        }
    );
}

// ==========================================
// PAGINATION
// ==========================================
function setupPagination() {
    document.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageNum = link.textContent.trim();
            if (pageNum === 'Next >') {
                navigateToPage(currentPage + 1);
            } else {
                navigateToPage(parseInt(pageNum, 10));
            }
        });
    });
}

function navigateToPage(page) {
    let url = `search.html?q=${encodeURIComponent(currentQuery)}&page=${page}`;
    if (isImageMode) url += '&tbm=isch';
    window.location.href = url;
}

function updatePagination(activePage) {
    const paginationLinks = document.querySelector('.pagination-links');
    if (!paginationLinks) return;

    let html = '';
    for (let i = 1; i <= 10; i++) {
        if (i === activePage) {
            html += `<span class="page-current">${i}</span>`;
        } else {
            html += `<a href="#" class="page-link" onclick="navigateToPage(${i});return false;">${i}</a>`;
        }
    }
    html += `<a href="#" class="page-link next-link" onclick="navigateToPage(${activePage + 1});return false;">Next &gt;</a>`;
    paginationLinks.innerHTML = html;
}

// ==========================================
// UTILS
// ==========================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Persistent in-memory set of URLs the user has opened
const visitedUrls = new Set();

// Pool of all image URLs generated this session — reused for page placeholders
const imagePool = [];

function renderWebResultsHtml(results) {
    return results.map(r => {
        const url = `https://${r.domain || 'example.com'}${r.path || ''}`;
        const safeUrl = escapeHtml(url);
        const safeTitle = escapeHtml(r.title || '');
        const safeSnippet = escapeHtml(r.snippet || '');
        return `
            <div class="result-item"
                 data-result-url="${safeUrl}"
                 data-result-title="${safeTitle}"
                 data-result-snippet="${safeSnippet}">
                <div class="result-url-row">
                    <div class="result-favicon">${r.favicon || '🌐'}</div>
                    <div class="result-site-info">
                        <span class="result-site-name">${escapeHtml(r.siteName || r.domain || '')}</span>
                        <span class="result-url">${safeUrl}</span>
                    </div>
                </div>
                <div class="result-title result-link${visitedUrls.has(url) ? ' visited' : ''}">${safeTitle}</div>
                <div class="result-snippet">${safeSnippet}</div>
            </div>
        `;
    }).join('');
}

function normalizeSearchResults(payload) {
    if (payload && Array.isArray(payload.results)) {
        return payload.results;
    }

    const output = payload ? payload.output : null;
    if (!output) return [];

    let outputText = output;
    if (Array.isArray(output)) {
        outputText = output.join('');
    } else if (typeof output !== 'string') {
        outputText = String(output);
    }

    const start = outputText.indexOf('{');
    const end = outputText.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return [];

    try {
        const parsed = JSON.parse(outputText.slice(start, end + 1));
        return Array.isArray(parsed.results) ? parsed.results : [];
    } catch (_err) {
        return [];
    }
}

// ==========================================
// PAGE VIEWER — fake browser overlay
// ==========================================
(function setupPageViewer() {
    // Inject overlay HTML
    document.body.insertAdjacentHTML('beforeend', `
        <div class="page-viewer-overlay" id="page-viewer-overlay">
            <div class="page-viewer-bar">
                <button class="page-viewer-back" id="pv-back" title="Back" disabled>&#x2190;</button>
                <div class="page-viewer-address" id="pv-address">
                    <span class="pv-favicon" id="pv-favicon">&#x1F512;</span>
                    <span class="pv-url-text" id="pv-url-text"></span>
                </div>
                <button class="page-viewer-close" id="pv-close" title="Close">&#x2715;</button>
            </div>
            <div class="page-viewer-body">
                <div class="pv-progress-bar" id="pv-progress"><div class="pv-progress-fill" id="pv-progress-fill"></div></div>
                <div class="pv-gen-overlay" id="pv-gen-overlay">
                    <div class="pv-gen-msg" id="pv-gen-msg">Loading…</div>
                    <div class="pv-gen-timer" id="pv-gen-timer"></div>
                </div>
                <iframe class="page-viewer-iframe" id="pv-iframe"
                        sandbox="allow-scripts allow-popups allow-forms"
                        title="Page viewer"></iframe>
            </div>
        </div>
    `);

    const overlay      = document.getElementById('page-viewer-overlay');
    const addrEl       = document.getElementById('pv-address');
    const urlTextEl    = document.getElementById('pv-url-text');
    const faviconEl    = document.getElementById('pv-favicon');
    const closeBtn     = document.getElementById('pv-close');
    const backBtn      = document.getElementById('pv-back');
    const iframe       = document.getElementById('pv-iframe');
    const progressBar  = document.getElementById('pv-progress');
    const progressFill = document.getElementById('pv-progress-fill');

    const genOverlay  = document.getElementById('pv-gen-overlay');
    const genMsgEl    = document.getElementById('pv-gen-msg');
    const genTimerEl  = document.getElementById('pv-gen-timer');

    const _genMessages = [
        'Loading…',
        'Connecting to server…',
        'Fetching content…',
        'Retrieving page…',
        'Almost there…',
        'Hold tight…',
        'One moment…',
        'Still loading…',
        'Worth the wait…',
        'Please wait…',
        'On its way…',
        'Nearly done…',
    ];
    let _genMsgIdx = 0;
    let _genMsgInterval = null;
    let _genTimerInterval = null;
    let _genStartTime = 0;

    function startGenOverlay() {
        _genMsgIdx = 0;
        _genStartTime = Date.now();
        genMsgEl.textContent = _genMessages[0];
        genTimerEl.textContent = '';
        genOverlay.classList.add('visible');

        _genMsgInterval = setInterval(() => {
            genMsgEl.classList.add('fade');
            setTimeout(() => {
                _genMsgIdx = (_genMsgIdx + 1) % _genMessages.length;
                genMsgEl.textContent = _genMessages[_genMsgIdx];
                genMsgEl.classList.remove('fade');
            }, 400);
        }, 3000);

        _genTimerInterval = setInterval(() => {
            const s = Math.floor((Date.now() - _genStartTime) / 1000);
            genTimerEl.textContent = s + 's';
        }, 1000);
    }

    function stopGenOverlay() {
        clearInterval(_genMsgInterval);
        clearInterval(_genTimerInterval);
        _genMsgInterval = null;
        _genTimerInterval = null;
        genOverlay.classList.remove('visible');
    }

    let history = [];
    let activeEs = null;
    let progressTimer = null;
    let currentUrl = null;        // url currently loaded/loading
    let currentRawBuffer = '';    // buffer for in-progress stream
    const pageCache = new Map(); // url -> { finalHtml, rawBuffer }

    function startProgress() {
        progressBar.style.display = 'block';
        progressFill.style.transition = 'none';
        progressFill.style.width = '0%';
        faviconEl.classList.add('loading');
        // Crawl to 85% over ~90s, simulating slow generation
        requestAnimationFrame(() => {
            progressFill.style.transition = 'width 20s cubic-bezier(0.05,0.3,0.5,1)';
            progressFill.style.width = '85%';
        });
        startGenOverlay();
    }

    function finishProgress() {
        stopGenOverlay();
        progressFill.style.transition = 'width 0.25s ease';
        progressFill.style.width = '100%';
        faviconEl.classList.remove('loading');
        faviconEl.textContent = '\uD83D\uDD12'; // lock
        clearTimeout(progressTimer);
        progressTimer = setTimeout(() => { progressBar.style.display = 'none'; }, 350);
    }

    function closeViewer() {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        stopGenOverlay();
        if (activeEs) {
            activeEs.close(); activeEs = null;
            // Save whatever we streamed so far so revisit is instant
            if (currentUrl && currentRawBuffer && !pageCache.has(currentUrl)) {
                pageCache.set(currentUrl, { finalHtml: currentRawBuffer, rawBuffer: currentRawBuffer });
            }
        }
        clearTimeout(progressTimer);
        history = [];
        currentUrl = null;
        currentRawBuffer = '';
        // Blank the iframe so the next open always gets a fresh render
        iframe.srcdoc = '';
    }

    /** Fill data-latent-img placeholders using already-generated images from the pool. */
    function hydrateLazyImages(htmlBuffer) {
        if (!imagePool.length) return;
        const re = /data-latent-img="([^"]+)"/g;
        let match;
        let idx = 0;
        while ((match = re.exec(htmlBuffer)) !== null) {
            const imgIdx = idx++;
            const url = imagePool[Math.floor(Math.random() * imagePool.length)];
            // Small stagger so the iframe has loaded its srcdoc
            setTimeout(() => {
                try {
                    iframe.contentWindow.postMessage(
                        { type: 'latent-img', idx: imgIdx, url },
                        '*'
                    );
                } catch (_e) { /* iframe may not be ready */ }
            }, 100 + imgIdx * 30);
        }
    }

    // ── Seeded template engine ──────────────────────────────────────────────
    function _rng(seed) {
        let h = seed >>> 0;
        return function () {
            h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
            return (h >>> 0) / 4294967296;
        };
    }
    function _strSeed(str) {
        let h = 0xdeadbeef;
        for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 2654435761) >>> 0;
        return h;
    }
    function _pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
    function _ri(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

    const _FONTS = [
        { d: 'Playfair Display',   b: 'Source Serif 4',  gf: 'Playfair+Display:wght@400;700;900&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;1,8..60,400&display=swap' },
        { d: 'DM Serif Display',   b: 'DM Sans',         gf: 'DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&display=swap' },
        { d: 'Fraunces',           b: 'Epilogue',        gf: 'Fraunces:ital,opsz,wght@0,9..144,700;0,9..144,900&family=Epilogue:wght@300;400;500&display=swap' },
        { d: 'Cormorant Garamond', b: 'Jost',            gf: 'Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Jost:wght@300;400;500&display=swap' },
        { d: 'Space Grotesk',      b: 'Space Grotesk',   gf: 'Space+Grotesk:wght@300;400;500;600;700&display=swap' },
        { d: 'Libre Baskerville',  b: 'Libre Franklin',  gf: 'Libre+Baskerville:ital,wght@0,700;1,400&family=Libre+Franklin:wght@300;400;500;600&display=swap' },
        { d: 'Syne',               b: 'Syne',            gf: 'Syne:wght@400;600;700;800&display=swap' },
        { d: 'Unbounded',          b: 'Outfit',          gf: 'Unbounded:wght@400;600;700;900&family=Outfit:wght@300;400;500&display=swap' },
        { d: 'Italiana',           b: 'Raleway',         gf: 'Italiana&family=Raleway:wght@300;400;500;600&display=swap' },
        { d: 'Big Shoulders Display', b: 'Inter',        gf: 'Big+Shoulders+Display:wght@600;700;800;900&family=Inter:wght@300;400;500&display=swap' },
        { d: 'Yeseva One',         b: 'Josefin Sans',    gf: 'Yeseva+One&family=Josefin+Sans:wght@300;400;600&display=swap' },
        { d: 'Abril Fatface',      b: 'Lato',            gf: 'Abril+Fatface&family=Lato:ital,wght@0,300;0,400;1,300&display=swap' },
    ];
    const _PALETTES = [
        { p: '#1a3a2a', bg: '#f5f2ed', acc: '#c9963a', tx: '#1a1a1a', s: '#dfe9de', navBg: '#1a3a2a', navTx: '#ffffff' },
        { p: '#7a1e28', bg: '#fdf8f5', acc: '#c17f24', tx: '#1a0a08', s: '#fbe8e4', navBg: '#7a1e28', navTx: '#ffffff' },
        { p: '#1c3557', bg: '#f2f6fb', acc: '#e8792a', tx: '#0f1923', s: '#ddeaf7', navBg: '#1c3557', navTx: '#ffffff' },
        { p: '#2d4a3e', bg: '#f6f9f4', acc: '#88b04b', tx: '#1a1f18', s: '#e1eedd', navBg: '#2d4a3e', navTx: '#ffffff' },
        { p: '#5c2d91', bg: '#f8f4ff', acc: '#e8a030', tx: '#1a0f2e', s: '#e8dcf7', navBg: '#5c2d91', navTx: '#ffffff' },
        { p: '#8a3500', bg: '#fdf5ee', acc: '#3d9e8a', tx: '#1f0e00', s: '#fde5cc', navBg: '#8a3500', navTx: '#ffffff' },
        { p: '#0d3b4f', bg: '#edf7fb', acc: '#f0a500', tx: '#0a1e28', s: '#c8e8f5', navBg: '#0d3b4f', navTx: '#ffffff' },
        { p: '#1f1f1f', bg: '#f8f8f6', acc: '#c0392b', tx: '#1f1f1f', s: '#eeeeec', navBg: '#1f1f1f', navTx: '#ffffff' },
        { p: '#046e50', bg: '#ffffff', acc: '#ff6b35', tx: '#111111', s: '#e8f5f1', navBg: '#ffffff', navTx: '#046e50' },
        { p: '#1a1a2e', bg: '#0f0f23', acc: '#e94560', tx: '#eaeaea', s: '#16213e', navBg: '#0f0f23', navTx: '#e94560' },
        { p: '#b5451b', bg: '#fefefe', acc: '#333333', tx: '#1a1a1a', s: '#fdf0eb', navBg: '#fefefe', navTx: '#b5451b' },
        { p: '#004e64', bg: '#e8f4f8', acc: '#f77f00', tx: '#00212b', s: '#c8e6ef', navBg: '#004e64', navTx: '#ffffff' },
        { p: '#3d348b', bg: '#fafafe', acc: '#f18f01', tx: '#1a1535', s: '#eae8f8', navBg: '#3d348b', navTx: '#ffffff' },
        { p: '#333333', bg: '#fafaf8', acc: '#d4a853', tx: '#1a1a1a', s: '#f0ede8', navBg: '#fafaf8', navTx: '#333333' },
        { p: '#006d5b', bg: '#f0faf7', acc: '#ff4500', tx: '#002b24', s: '#c7ede5', navBg: '#006d5b', navTx: '#ffffff' },
    ];

    // 20 layout types
    const _LAYOUTS = [
        'classic-blog',       // 0: single column, full-width hero image, big serif heading
        'magazine',           // 1: 3-column grid cards for sections
        'portfolio',          // 2: dark sidebar nav + content area
        'startup',            // 3: centered hero, feature tiles, big CTA
        'newspaper',          // 4: tight multi-col text, drop cap, rule separators
        'corporate',          // 5: top nav, hero split (text left, image right)
        'editorial',          // 6: large pull quotes, wide left-aligned titles
        'minimal',            // 7: white space, center-everything, small caps nav
        'agency',             // 8: full-bleed dark hero, neon accent, cards
        'wiki',               // 9: sidebar TOC + main content
        'ecommerce',          // 10: product cards grid, banner
        'landing',            // 11: hero + alternating feature rows
        'academic',           // 12: two-col, footnote-style, muted palette
        'tech-docs',          // 13: code-like mono font sections, dark header
        'magazine-cover',     // 14: oversized type hero, strip of teasers
        'travel-blog',        // 15: full-bleed images, overlaid text
        'luxury',             // 16: minimal, gold accents, thin type
        'nonprofit',          // 17: warm tones, large stats, mission hero
        'news-ticker',        // 18: top breaking-bar, timeline sections
        'brutalist',          // 19: heavy borders, large contrasting blocks
    ];

    function buildSeededPage(urlStr, c) {
        const rng    = _rng(_strSeed(urlStr));
        const font   = _pick(rng, _FONTS);
        const pal    = _pick(rng, _PALETTES);
        const layout = _pick(rng, _LAYOUTS);

        const esc    = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const paras  = b => (b || '').split(/\n\n+/).filter(Boolean).map(p => '<p>' + esc(p) + '</p>').join('');

        const brand  = esc(c.brand  || 'Site');
        const navItems = (c.nav || ['Home', 'About', 'Articles', 'Topics', 'Contact']).slice(0, 5);
        const hero   = c.hero || { headline: brand, sub: '' };
        const sects  = Array.isArray(c.sections) ? c.sections : [];
        const ftxt   = esc(c.footer || '\u00a9 2026 ' + brand);
        const df     = "'" + font.d + "',Georgia,serif";
        const bf     = "'" + font.b + "',system-ui,sans-serif";
        const mf     = "'Space Mono','Courier New',monospace";

        const sc = '<' + 'script>';
        const ec = '<' + '/script>';
        const inlineScript = sc +
            '(function(){' +
            'document.addEventListener("click",function(e){var a=e.target.closest("a");if(a){e.preventDefault();e.stopPropagation();}},true);' +
            'window.addEventListener("message",function(e){if(!e.data||e.data.type!=="latent-img")return;' +
            'var imgs=document.querySelectorAll("img[data-latent-idx]");' +
            'for(var i=0;i<imgs.length;i++){if(String(imgs[i].getAttribute("data-latent-idx"))===String(e.data.idx)){imgs[i].src=e.data.url;break;}}' +
            '});' +
            '})();' + ec;

        let imgIdx = 0;
        function latentImg(prompt, styles) {
            const i = imgIdx++;
            return '<img src="" data-latent-img="' + esc(prompt) + '" data-latent-idx="' + i + '" alt="" style="' + (styles || '') + '">';
        }

        // ── Nav builders ──────────────────────────────────────────────────
        function navBar(variant) {
            // variant: 'dark'|'light'|'border'|'transparent-dark'|'mono'|'tall'
            if (variant === 'light' || variant === 'border') {
                const brd = variant === 'border' ? ';border-bottom:2px solid ' + pal.p : '';
                return '<nav style="background:' + pal.navBg + brd + ';padding:0 clamp(16px,5vw,60px);position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;height:56px;">' +
                    '<span style="font-family:' + df + ';font-weight:700;font-size:1.1rem;color:' + pal.navTx + ';letter-spacing:-.01em;">' + brand + '</span>' +
                    '<div style="display:flex;gap:clamp(14px,2.5vw,34px);">' +
                    navItems.map(n => '<a href="#" style="font-family:' + bf + ';color:' + pal.navTx + ';opacity:.75;font-size:.85rem;text-decoration:none;font-weight:500;">' + esc(n) + '</a>').join('') +
                    '</div></nav>';
            }
            if (variant === 'mono') {
                return '<nav style="background:#111;padding:0 clamp(16px,5vw,60px);position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;height:48px;border-bottom:1px solid ' + pal.acc + ';">' +
                    '<span style="font-family:' + mf + ';font-size:.9rem;color:' + pal.acc + ';letter-spacing:.08em;text-transform:uppercase;">' + brand + '</span>' +
                    '<div style="display:flex;gap:24px;">' +
                    navItems.map(n => '<a href="#" style="font-family:' + mf + ';color:#aaa;font-size:.78rem;text-decoration:none;letter-spacing:.04em;">' + esc(n).toUpperCase() + '</a>').join('') +
                    '</div></nav>';
            }
            if (variant === 'tall') {
                return '<nav style="background:' + pal.p + ';padding:0 clamp(16px,5vw,60px);position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;height:72px;box-shadow:0 2px 12px rgba(0,0,0,.15);">' +
                    '<span style="font-family:' + df + ';font-weight:900;font-size:1.4rem;color:#fff;letter-spacing:-.02em;">' + brand + '</span>' +
                    '<div style="display:flex;gap:clamp(14px,2.5vw,36px);align-items:center;">' +
                    navItems.map((n, i) => i === navItems.length - 1
                        ? '<a href="#" style="font-family:' + bf + ';background:' + pal.acc + ';color:#fff;font-size:.8rem;font-weight:600;text-decoration:none;padding:8px 18px;border-radius:4px;">' + esc(n) + '</a>'
                        : '<a href="#" style="font-family:' + bf + ';color:rgba(255,255,255,.8);font-size:.85rem;text-decoration:none;">' + esc(n) + '</a>'
                    ).join('') +
                    '</div></nav>';
            }
            // default dark
            return '<nav style="background:' + pal.p + ';padding:0 clamp(16px,5vw,60px);position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;height:58px;">' +
                '<span style="font-family:' + df + ';font-weight:700;font-size:1.05rem;color:#fff;letter-spacing:-.01em;">' + brand + '</span>' +
                '<div style="display:flex;gap:clamp(12px,2.5vw,32px);">' +
                navItems.map(n => '<a href="#" style="font-family:' + bf + ';color:rgba(255,255,255,.82);font-size:.85rem;text-decoration:none;">' + esc(n) + '</a>').join('') +
                '</div></nav>';
        }

        function footer(variant) {
            if (variant === 'minimal') {
                return '<footer style="border-top:1px solid ' + pal.s + ';padding:24px clamp(16px,5vw,60px);text-align:center;">' +
                    '<span style="font-family:' + bf + ';color:' + pal.tx + ';opacity:.5;font-size:.82rem;">' + ftxt + '</span>' +
                    '</footer>';
            }
            if (variant === 'dark-multi') {
                return '<footer style="background:' + pal.p + ';padding:clamp(32px,5vw,64px) clamp(16px,5vw,60px);">' +
                    '<div style="max-width:1200px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr;gap:40px;">' +
                    '<div><span style="font-family:' + df + ';font-weight:700;font-size:1.3rem;color:#fff;">' + brand + '</span>' +
                    '<p style="font-family:' + bf + ';color:rgba(255,255,255,.55);margin-top:12px;font-size:.88rem;line-height:1.65;">' + esc(hero.sub || 'Explore, discover, learn.') + '</p></div>' +
                    '<div><p style="font-family:' + bf + ';font-weight:600;color:rgba(255,255,255,.9);font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Navigation</p>' +
                    navItems.map(n => '<p style="margin-bottom:8px;"><a href="#" style="font-family:' + bf + ';color:rgba(255,255,255,.6);font-size:.85rem;text-decoration:none;">' + esc(n) + '</a></p>').join('') +
                    '</div><div><p style="font-family:' + bf + ';font-weight:600;color:rgba(255,255,255,.9);font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Connect</p>' +
                    '<p style="font-family:' + bf + ';color:rgba(255,255,255,.5);font-size:.82rem;margin-top:20px;">' + ftxt + '</p></div>' +
                    '</div></footer>';
            }
            if (variant === 'accent') {
                return '<footer style="background:' + pal.acc + ';padding:clamp(20px,3vw,40px) clamp(16px,5vw,60px);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">' +
                    '<span style="font-family:' + df + ';font-weight:700;font-size:1.1rem;color:#fff;">' + brand + '</span>' +
                    '<span style="font-family:' + bf + ';color:rgba(255,255,255,.75);font-size:.82rem;">' + ftxt + '</span>' +
                    '</footer>';
            }
            return '<footer style="background:' + pal.p + ';padding:clamp(24px,4vw,48px) clamp(16px,5vw,60px);">' +
                '<div style="max-width:1200px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">' +
                '<span style="font-family:' + df + ';font-weight:700;color:#fff;">' + brand + '</span>' +
                '<span style="font-family:' + bf + ';color:rgba(255,255,255,.55);font-size:.83rem;">' + ftxt + '</span>' +
                '</div></footer>';
        }

        // ── BASE CSS ──────────────────────────────────────────────────────
        const baseCss =
            '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}' +
            'html,body{height:100%;}body{min-height:100vh;display:flex;flex-direction:column;background:' + pal.bg + ';color:' + pal.tx + ';}' +
            'main{flex:1;}p{margin-bottom:1em;}p:last-child{margin-bottom:0;}' +
            'img[src=""]{background:' + pal.s + ';display:block;}a{color:inherit;}';

        const mobileCss =
            '@media (max-width:900px){' +
            '[style*="display:grid"][style*="grid-template-columns:1fr 1fr"],[style*="display:grid"][style*="grid-template-columns:2fr 1fr"],[style*="display:grid"][style*="grid-template-columns:3fr 1fr"],[style*="display:grid"][style*="grid-template-columns:5fr 2fr"],[style*="display:grid"][style*="grid-template-columns:1fr 1fr 1fr"],[style*="display:grid"][style*="grid-template-columns:2fr 1fr 1fr"],[style*="display:grid"][style*="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))"],[style*="display:grid"][style*="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))"],[style*="display:grid"][style*="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))"]{grid-template-columns:1fr!important;}' +
            '[style*="position:sticky"][style*="height:100vh"],[style*="position:sticky"][style*="top:80px"],[style*="position:sticky"][style*="top:0"][style*="height:100vh"]{position:static!important;height:auto!important;top:auto!important;}' +
            '[style*="width:240px"],[style*="min-width:220px"],[style*="width:220px"],[style*="min-width:200px"]{width:100%!important;min-width:0!important;}' +
            '[style*="grid-column:span 2"]{grid-column:span 1!important;}' +
            '[style*="float:right"]{float:none!important;width:100%!important;margin:0 0 16px 0!important;}' +
            '[style*="min-height:600px"]{min-height:460px!important;}' +
            '[style*="min-height:500px"]{min-height:420px!important;}' +
            '[style*="height:420px"],[style*="height:400px"],[style*="height:380px"],[style*="height:360px"],[style*="height:320px"],[style*="height:300px"],[style*="height:280px"],[style*="height:260px"]{height:220px!important;}' +
            '[style*="font-size:clamp(3rem,8vw,7rem)"],[style*="font-size:clamp(3rem,7vw,6rem)"],[style*="font-size:clamp(3rem,8vw,6.5rem)"],[style*="font-size:clamp(2.8rem,7vw,5.5rem)"],[style*="font-size:clamp(2.5rem,6vw,5rem)"],[style*="font-size:clamp(2.5rem,6vw,4.5rem)"]{font-size:clamp(2rem,9vw,3rem)!important;line-height:1.06!important;}' +
            '[style*="display:flex"][style*="justify-content:space-between"][style*="align-items:center"][style*="height:56px"],[style*="display:flex"][style*="justify-content:space-between"][style*="align-items:center"][style*="height:58px"],[style*="display:flex"][style*="justify-content:space-between"][style*="align-items:center"][style*="height:72px"]{height:auto!important;min-height:56px!important;flex-wrap:wrap!important;row-gap:8px!important;padding-top:10px!important;padding-bottom:10px!important;}' +
            'main [style*="display:flex"],main [style*="display:grid"]{max-width:100%!important;}' +
            '}' +
            '@media (max-width:640px){body{font-size:16px;}nav a{min-height:44px!important;display:inline-flex!important;align-items:center!important;}[style*="display:flex"][style*="gap:24px"],[style*="display:flex"][style*="gap:28px"],[style*="display:flex"][style*="gap:36px"]{gap:12px!important;}main{padding-left:0!important;padding-right:0!important;}}';

        function wrapDoc(navH, mainH, footH, extraCss) {
            return '<!DOCTYPE html>\n<html lang="en"><head>' +
                '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<link rel="preconnect" href="https://fonts.googleapis.com">' +
                '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
                '<link href="https://fonts.googleapis.com/css2?family=' + font.gf + '" rel="stylesheet">' +
                '<style>' + baseCss + mobileCss + (extraCss || '') + '</style>' +
                '</head><body>' + navH + '<main>' + mainH + '</main>' + footH + inlineScript + '</body></html>';
        }

        // ── LAYOUT BUILDERS ───────────────────────────────────────────────

        if (layout === 'classic-blog') {
            const nav = navBar('border');
            const h1s = 'font-family:' + df + ';font-size:clamp(2.2rem,5vw,3.8rem);font-weight:900;line-height:1.1;color:' + pal.p + ';margin-bottom:20px;letter-spacing:-.02em;';
            let main = '<div style="max-width:740px;margin:0 auto;padding:clamp(40px,6vw,80px) clamp(16px,4vw,0px);">' +
                '<p style="font-family:' + bf + ';text-transform:uppercase;letter-spacing:.1em;font-size:.72rem;color:' + pal.acc + ';font-weight:600;margin-bottom:16px;">' + esc(navItems[1] || 'Feature') + '</p>' +
                '<h1 style="' + h1s + '">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + df + ';font-style:italic;font-size:1.2rem;color:' + pal.tx + ';opacity:.7;margin-bottom:32px;line-height:1.5;">' + esc(hero.sub) + '</p>' +
                '<div style="margin-bottom:36px;">' + latentImg('editorial photograph for ' + esc(hero.headline), 'width:100%;height:420px;object-fit:cover;display:block;') + '</div>' +
                '<div style="font-family:' + bf + ';font-size:1.05rem;line-height:1.85;color:' + pal.tx + ';">';
            sects.forEach(sec => {
                main += '<h2 style="font-family:' + df + ';font-size:1.7rem;font-weight:700;color:' + pal.p + ';margin:44px 0 14px;">' + esc(sec.heading) + '</h2>' +
                    paras(sec.body);
                if (sec.quote) main += '<blockquote style="border-left:4px solid ' + pal.acc + ';margin:28px 0;padding:10px 22px;font-family:' + df + ';font-size:1.25rem;font-style:italic;color:' + pal.p + ';">' + esc(sec.quote) + '</blockquote>';
            });
            main += '</div></div>';
            return wrapDoc(nav, main, footer('minimal'), '');
        }

        if (layout === 'magazine') {
            const nav = navBar('tall');
            const hero_html =
                '<div style="background:' + pal.p + ';padding:clamp(48px,7vw,96px) clamp(16px,5vw,60px);text-align:center;">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.5rem,6vw,4.5rem);font-weight:900;color:#fff;line-height:1.05;letter-spacing:-.025em;max-width:900px;margin:0 auto 20px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.75);font-size:1.1rem;max-width:600px;margin:0 auto 32px;">' + esc(hero.sub) + '</p>' +
                '</div>';
            let cards = '<div style="max-width:1200px;margin:0 auto;padding:clamp(32px,5vw,64px) clamp(16px,4vw,40px);display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:clamp(20px,3vw,36px);">';
            sects.forEach((sec, i) => {
                const bg2 = i%2===0 ? pal.bg : pal.s;
                cards += '<article style="background:' + bg2 + ';border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);">' +
                    latentImg('editorial photograph for ' + esc(sec.heading), 'width:100%;height:200px;object-fit:cover;') +
                    '<div style="padding:22px;"><p style="font-family:' + bf + ';font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:' + pal.acc + ';font-weight:600;margin-bottom:8px;">' + esc(navItems[i%navItems.length] || 'Feature') + '</p>' +
                    '<h3 style="font-family:' + df + ';font-size:1.25rem;font-weight:700;color:' + pal.p + ';margin-bottom:10px;line-height:1.25;">' + esc(sec.heading) + '</h3>' +
                    '<div style="font-family:' + bf + ';font-size:.9rem;line-height:1.7;color:' + pal.tx + ';opacity:.8;">' + paras(sec.body) + '</div></div></article>';
            });
            cards += '</div>';
            return wrapDoc(nav, hero_html + cards, footer('dark-multi'), '');
        }

        if (layout === 'portfolio') {
            const sideNav =
                '<div style="width:240px;min-width:220px;background:' + pal.p + ';min-height:100vh;padding:40px 28px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;">' +
                '<span style="font-family:' + df + ';font-weight:900;font-size:1.5rem;color:#fff;letter-spacing:-.02em;margin-bottom:48px;display:block;">' + brand + '</span>' +
                navItems.map((n, i) => '<a href="#" style="font-family:' + bf + ';color:' + (i===0 ? '#fff' : 'rgba(255,255,255,.55)') + ';font-size:.9rem;text-decoration:none;padding:10px 0;display:block;border-bottom:' + (i===0 ? '1px solid ' + pal.acc : '1px solid rgba(255,255,255,.08)') + ';">' + esc(n) + '</a>').join('') +
                '<div style="margin-top:auto;"><p style="font-family:' + bf + ';color:rgba(255,255,255,.3);font-size:.75rem;">' + ftxt + '</p></div>' +
                '</div>';
            let content = '<div style="flex:1;padding:clamp(40px,5vw,72px) clamp(20px,4vw,56px);">' +
                latentImg('professional portfolio hero for ' + esc(hero.headline), 'width:100%;height:360px;object-fit:cover;border-radius:12px;margin-bottom:36px;') +
                '<h1 style="font-family:' + df + ';font-size:clamp(2rem,4vw,3rem);font-weight:900;color:' + pal.p + ';margin-bottom:16px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';font-size:1.05rem;color:' + pal.tx + ';opacity:.75;margin-bottom:44px;line-height:1.7;">' + esc(hero.sub) + '</p>';
            sects.forEach(sec => {
                content += '<section style="margin-bottom:48px;padding-bottom:48px;border-bottom:1px solid ' + pal.s + ';">' +
                    '<h2 style="font-family:' + df + ';font-size:1.5rem;font-weight:700;color:' + pal.p + ';margin-bottom:14px;">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:.97rem;line-height:1.8;color:' + pal.tx + ';">' + paras(sec.body) + '</div></section>';
            });
            content += '</div>';
            const mainWrap = '<div style="display:flex;">' + sideNav + content + '</div>';
            return wrapDoc('', mainWrap, '', 'body{overflow-x:hidden;}');
        }

        if (layout === 'startup') {
            const nav = navBar('tall');
            const heroHtml =
                '<div style="text-align:center;padding:clamp(64px,10vw,120px) clamp(16px,5vw,60px);background:' + pal.bg + ';">' +
                '<p style="font-family:' + bf + ';text-transform:uppercase;letter-spacing:.12em;font-size:.72rem;font-weight:700;color:' + pal.acc + ';margin-bottom:20px;">' + esc(navItems[0] || 'New') + ' &mdash; ' + new Date().getFullYear() + '</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.8rem,7vw,5.5rem);font-weight:900;line-height:1.0;color:' + pal.p + ';letter-spacing:-.03em;max-width:800px;margin:0 auto 28px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';font-size:clamp(1rem,2vw,1.25rem);color:' + pal.tx + ';opacity:.7;max-width:540px;margin:0 auto 40px;line-height:1.65;">' + esc(hero.sub) + '</p>' +
                '<a href="#" style="display:inline-block;font-family:' + bf + ';background:' + pal.p + ';color:#fff;text-decoration:none;padding:14px 36px;border-radius:6px;font-weight:600;font-size:.95rem;">Get Started &rarr;</a>' +
                '</div>';
            let tiles = '<div style="max-width:1100px;margin:0 auto;padding:0 clamp(16px,4vw,40px) clamp(48px,7vw,80px);display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;">';
            sects.forEach((sec, i) => {
                tiles += '<div style="background:' + (i%2===0 ? pal.s : pal.bg) + ';border:1px solid ' + pal.s + ';border-radius:12px;padding:28px;box-shadow:0 1px 6px rgba(0,0,0,.04);">' +
                    '<div style="font-size:1.8rem;margin-bottom:14px;">' + ['🚀','💡','⚡','🎯','🔮','✨'][i%6] + '</div>' +
                    '<h3 style="font-family:' + df + ';font-size:1.15rem;font-weight:700;color:' + pal.p + ';margin-bottom:10px;">' + esc(sec.heading) + '</h3>' +
                    '<p style="font-family:' + bf + ';font-size:.9rem;line-height:1.7;color:' + pal.tx + ';opacity:.8;">' + esc((sec.body||'').substring(0,180)) + '</p></div>';
            });
            tiles += '</div>';
            return wrapDoc(nav, heroHtml + tiles, footer('dark-multi'), '');
        }

        if (layout === 'newspaper') {
            const nav = navBar('border');
            const date = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
            const header =
                '<div style="border-bottom:4px solid ' + pal.p + ';padding:16px clamp(16px,5vw,60px);text-align:center;">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.5rem,6vw,5rem);font-weight:900;color:' + pal.p + ';letter-spacing:-.02em;line-height:1;">' + brand + '</h1>' +
                '<div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid ' + pal.tx + ';border-bottom:1px solid ' + pal.tx + ';padding:6px 0;margin-top:8px;">' +
                '<span style="font-family:' + bf + ';font-size:.75rem;color:' + pal.tx + ';">' + date + '</span>' +
                '<span style="font-family:' + bf + ';font-size:.75rem;color:' + pal.tx + ';font-weight:600;">' + esc(navItems.join(' \u2022 ')) + '</span>' +
                '</div></div>';
            const lead =
                '<div style="max-width:1100px;margin:0 auto;padding:clamp(24px,4vw,40px) clamp(16px,4vw,40px);display:grid;grid-template-columns:2fr 1fr;gap:clamp(24px,4vw,48px);">' +
                '<div>' +
                '<span style="font-family:' + bf + ';font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;background:' + pal.p + ';color:#fff;padding:2px 8px;margin-bottom:14px;display:inline-block;">' + esc(navItems[0] || 'News') + '</span>' +
                '<h2 style="font-family:' + df + ';font-size:clamp(1.8rem,3.5vw,2.8rem);font-weight:900;color:' + pal.p + ';line-height:1.1;margin-bottom:14px;letter-spacing:-.01em;">' + esc(hero.headline) + '</h2>' +
                '<p style="font-family:' + bf + ';font-size:.95rem;line-height:1.75;color:' + pal.tx + ';margin-bottom:16px;">' + esc(hero.sub) + '</p>' +
                latentImg('news photograph for ' + esc(hero.headline), 'width:100%;height:280px;object-fit:cover;margin-top:16px;') +
                '</div><div style="border-left:1px solid ' + pal.s + ';padding-left:clamp(18px,3vw,36px);">' +
                sects.slice(0,3).map(sec =>
                    '<div style="padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid ' + pal.s + ';">' +
                    '<h3 style="font-family:' + df + ';font-size:1.05rem;font-weight:700;color:' + pal.p + ';margin-bottom:6px;">' + esc(sec.heading) + '</h3>' +
                    '<p style="font-family:' + bf + ';font-size:.83rem;line-height:1.65;color:' + pal.tx + ';opacity:.8;">' + esc((sec.body||'').substring(0,160)) + '</p></div>'
                ).join('') +
                '</div></div>';
            return wrapDoc(nav, header + lead, footer('minimal'), '');
        }

        if (layout === 'corporate') {
            const nav = navBar('tall');
            const split =
                '<div style="background:' + pal.bg + ';display:grid;grid-template-columns:1fr 1fr;min-height:500px;">' +
                '<div style="display:flex;align-items:center;padding:clamp(40px,6vw,88px) clamp(16px,5vw,72px);background:' + pal.p + ';">' +
                '<div><p style="font-family:' + bf + ';text-transform:uppercase;letter-spacing:.12em;font-size:.72rem;font-weight:700;color:' + pal.acc + ';margin-bottom:16px;">' + esc(navItems[0] || 'Solutions') + '</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2rem,4vw,3.2rem);font-weight:900;color:#fff;line-height:1.1;margin-bottom:20px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.75);font-size:1rem;line-height:1.7;margin-bottom:32px;">' + esc(hero.sub) + '</p>' +
                '<a href="#" style="display:inline-block;font-family:' + bf + ';background:' + pal.acc + ';color:#fff;text-decoration:none;padding:12px 30px;border-radius:4px;font-weight:600;font-size:.9rem;">Learn More</a>' +
                '</div></div>' +
                '<div>' + latentImg('professional corporate photograph for ' + esc(hero.headline), 'width:100%;height:100%;object-fit:cover;min-height:400px;') + '</div>' +
                '</div>';
            let features = '<div style="max-width:1100px;margin:0 auto;padding:clamp(48px,6vw,80px) clamp(16px,4vw,40px);display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px;">';
            sects.forEach((sec, i) => {
                const icons = ['◆','●','▲','■','★','◉'];
                features += '<div><div style="font-family:' + df + ';font-size:1.4rem;color:' + pal.acc + ';margin-bottom:14px;">' + icons[i%6] + '</div>' +
                    '<h3 style="font-family:' + df + ';font-size:1.2rem;font-weight:700;color:' + pal.p + ';margin-bottom:10px;">' + esc(sec.heading) + '</h3>' +
                    '<p style="font-family:' + bf + ';font-size:.9rem;line-height:1.75;color:' + pal.tx + ';opacity:.8;">' + esc((sec.body||'').substring(0,200)) + '</p></div>';
            });
            features += '</div>';
            return wrapDoc(nav, split + features, footer('dark-multi'), '');
        }

        if (layout === 'editorial') {
            const nav = navBar('border');
            let main = '<div style="max-width:1000px;margin:0 auto;padding:clamp(48px,6vw,88px) clamp(16px,4vw,40px);">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(3rem,7vw,6rem);font-weight:900;color:' + pal.p + ';line-height:.95;letter-spacing:-.03em;margin-bottom:32px;">' + esc(hero.headline) + '</h1>' +
                '<div style="display:grid;grid-template-columns:1fr 2fr;gap:40px;margin-bottom:56px;align-items:start;">' +
                '<div style="border-top:3px solid ' + pal.acc + ';padding-top:20px;">' +
                '<p style="font-family:' + bf + ';font-size:.8rem;line-height:1.65;color:' + pal.tx + ';opacity:.6;">' + esc(hero.sub) + '</p></div>' +
                '<div>' + latentImg('editorial fashion photograph for ' + esc(hero.headline), 'width:100%;height:360px;object-fit:cover;') + '</div>' +
                '</div>';
            sects.forEach((sec, i) => {
                if (i === 1) {
                    main += '<blockquote style="font-family:' + df + ';font-size:clamp(1.6rem,3.5vw,2.5rem);font-style:italic;color:' + pal.p + ';border-left:5px solid ' + pal.acc + ';padding:20px 32px;margin:40px 0;line-height:1.3;">' +
                        esc(sec.quote || sec.heading) + '</blockquote>';
                }
                main += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:clamp(24px,4vw,56px);margin-bottom:56px;">' +
                    '<div><h2 style="font-family:' + df + ';font-size:1.7rem;font-weight:700;color:' + pal.p + ';margin-bottom:18px;">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:.97rem;line-height:1.8;color:' + pal.tx + ';">' + paras(sec.body) + '</div></div>' +
                    '<div>' + latentImg('editorial photograph for ' + esc(sec.heading), 'width:100%;height:280px;object-fit:cover;') + '</div></div>';
            });
            main += '</div>';
            return wrapDoc(nav, main, footer('minimal'), '');
        }

        if (layout === 'minimal') {
            const nav =
                '<nav style="padding:0 clamp(16px,5vw,60px);height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ' + pal.s + ';">' +
                '<span style="font-family:' + df + ';font-weight:700;font-size:1rem;color:' + pal.p + ';letter-spacing:.02em;">' + brand.toUpperCase() + '</span>' +
                '<div style="display:flex;gap:28px;">' +
                navItems.map(n => '<a href="#" style="font-family:' + bf + ';font-size:.8rem;font-weight:500;text-transform:uppercase;letter-spacing:.1em;color:' + pal.tx + ';opacity:.5;text-decoration:none;">' + esc(n) + '</a>').join('') +
                '</div></nav>';
            let main = '<div style="max-width:640px;margin:0 auto;padding:clamp(64px,9vw,110px) clamp(16px,4vw,0px);text-align:center;">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.2rem,5vw,3.5rem);font-weight:700;color:' + pal.p + ';line-height:1.15;margin-bottom:24px;letter-spacing:-.015em;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';font-size:1.1rem;color:' + pal.tx + ';opacity:.65;line-height:1.75;margin-bottom:56px;">' + esc(hero.sub) + '</p></div>' +
                '<div style="max-width:640px;margin:0 auto;padding:0 clamp(16px,4vw,0px);">';
            sects.forEach((sec, i) => {
                main += '<div style="margin-bottom:64px;padding-bottom:64px;border-bottom:' + (i < sects.length-1 ? '1px solid ' + pal.s : 'none') + ';">' +
                    '<h2 style="font-family:' + df + ';font-size:1.4rem;font-weight:600;color:' + pal.p + ';margin-bottom:16px;">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:1rem;line-height:1.85;color:' + pal.tx + ';opacity:.8;">' + paras(sec.body) + '</div></div>';
            });
            main += '</div>';
            return wrapDoc(nav, main, footer('minimal'), '');
        }

        if (layout === 'agency') {
            const darkPal = { bg:'#0a0a0a', p:pal.acc, tx:'#f0f0f0', s:'#1a1a1a' };
            const nav =
                '<nav style="background:#0a0a0a;padding:0 clamp(16px,5vw,60px);position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;height:60px;border-bottom:1px solid #1f1f1f;">' +
                '<span style="font-family:' + df + ';font-weight:900;font-size:1.2rem;color:#fff;letter-spacing:-.01em;">' + brand + '</span>' +
                '<div style="display:flex;gap:28px;align-items:center;">' +
                navItems.map((n, i) => i === navItems.length-1
                    ? '<a href="#" style="font-family:' + bf + ';background:' + pal.acc + ';color:#fff;font-size:.82rem;font-weight:700;text-decoration:none;padding:8px 20px;border-radius:4px;">' + esc(n) + '</a>'
                    : '<a href="#" style="font-family:' + bf + ';color:rgba(255,255,255,.5);font-size:.85rem;text-decoration:none;">' + esc(n) + '</a>'
                ).join('') +
                '</div></nav>';
            const heroHtml =
                '<div style="background:#0a0a0a;padding:clamp(80px,10vw,140px) clamp(16px,5vw,60px);">' +
                '<p style="font-family:' + mf + ';font-size:.75rem;color:' + pal.acc + ';letter-spacing:.15em;text-transform:uppercase;margin-bottom:24px;">' + esc(navItems[0]||'Studio') + ' &mdash; ' + new Date().getFullYear() + '</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(3rem,8vw,6.5rem);font-weight:900;color:#fff;line-height:.95;letter-spacing:-.03em;max-width:800px;margin-bottom:36px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.5);font-size:1.1rem;max-width:500px;line-height:1.65;">' + esc(hero.sub) + '</p>' +
                '</div>';
            let cards = '<div style="max-width:1200px;margin:0 auto;padding:clamp(40px,6vw,80px) clamp(16px,4vw,40px);display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:2px;background:#1a1a1a;">';
            sects.forEach((sec, i) => {
                cards += '<div style="background:#0a0a0a;padding:clamp(28px,4vw,48px);">' +
                    '<span style="font-family:' + mf + ';font-size:.7rem;color:' + pal.acc + ';letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:16px;">0' + (i+1) + '</span>' +
                    '<h3 style="font-family:' + df + ';font-size:1.4rem;font-weight:700;color:#fff;margin-bottom:14px;">' + esc(sec.heading) + '</h3>' +
                    '<p style="font-family:' + bf + ';font-size:.9rem;line-height:1.75;color:rgba(255,255,255,.5);">' + esc((sec.body||'').substring(0,200)) + '</p></div>';
            });
            cards += '</div>';
            return wrapDoc(nav, heroHtml + cards, '<footer style="background:#0a0a0a;border-top:1px solid #1a1a1a;padding:24px clamp(16px,5vw,60px);display:flex;justify-content:space-between;align-items:center;"><span style="font-family:' + df + ';font-weight:700;color:#fff;">' + brand + '</span><span style="font-family:' + mf + ';font-size:.72rem;color:rgba(255,255,255,.3);">' + ftxt + '</span></footer>', 'body{background:#0a0a0a;}');
        }

        if (layout === 'wiki') {
            const nav = navBar('border');
            const tocItems = sects.map((sec, i) => '<li style="margin-bottom:6px;"><a href="#" style="font-family:' + bf + ';font-size:.85rem;color:' + pal.p + ';text-decoration:none;">' + (i+1) + '. ' + esc(sec.heading) + '</a></li>').join('');
            const sidebar =
                '<aside style="width:220px;min-width:200px;padding:28px 20px;border:1px solid ' + pal.s + ';border-radius:8px;height:fit-content;position:sticky;top:80px;background:' + pal.s + ';">' +
                '<p style="font-family:' + bf + ';font-weight:700;font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:' + pal.p + ';margin-bottom:14px;">Contents</p>' +
                '<ol style="padding-left:4px;list-style:none;">' + tocItems + '</ol></aside>';
            let content = '<div style="flex:1;min-width:0;">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(1.8rem,3.5vw,2.8rem);font-weight:900;color:' + pal.p + ';margin-bottom:16px;padding-bottom:14px;border-bottom:2px solid ' + pal.s + ';">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';font-size:1rem;font-style:italic;color:' + pal.tx + ';opacity:.7;margin-bottom:32px;">' + esc(hero.sub) + '</p>';
            sects.forEach((sec, i) => {
                content += '<h2 style="font-family:' + df + ';font-size:1.4rem;font-weight:700;color:' + pal.p + ';margin:36px 0 14px;padding-bottom:8px;border-bottom:1px solid ' + pal.s + ';">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:.97rem;line-height:1.8;color:' + pal.tx + ';">' + paras(sec.body) + '</div>';
                if (sec.has_image) content += '<div style="float:right;margin:0 0 20px 24px;width:220px;">' + latentImg('reference image for ' + esc(sec.heading), 'width:100%;height:160px;object-fit:cover;border:1px solid ' + pal.s + ';') + '<p style="font-family:' + bf + ';font-size:.72rem;color:' + pal.tx + ';opacity:.55;padding:6px;text-align:center;">' + esc(sec.heading) + '</p></div>';
            });
            content += '</div>';
            const main = '<div style="max-width:1100px;margin:0 auto;padding:clamp(32px,5vw,56px) clamp(16px,4vw,40px);display:flex;gap:clamp(24px,4vw,48px);align-items:start;">' + content + sidebar + '</div>';
            return wrapDoc(nav, main, footer('minimal'), '');
        }

        if (layout === 'ecommerce') {
            const nav = navBar('tall');
            const banner =
                '<div style="background:' + pal.p + ';padding:clamp(48px,7vw,96px) clamp(16px,5vw,60px);display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;">' +
                '<div><p style="font-family:' + bf + ';color:' + pal.acc + ';text-transform:uppercase;letter-spacing:.1em;font-size:.72rem;font-weight:700;margin-bottom:14px;">New Collection</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2rem,4.5vw,3.5rem);font-weight:900;color:#fff;line-height:1.05;margin-bottom:20px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.7);line-height:1.65;margin-bottom:28px;">' + esc(hero.sub) + '</p>' +
                '<a href="#" style="display:inline-block;font-family:' + bf + ';background:#fff;color:' + pal.p + ';text-decoration:none;padding:13px 32px;border-radius:40px;font-weight:700;font-size:.9rem;">Shop Now</a></div>' +
                '<div>' + latentImg('product lifestyle photograph for ' + esc(hero.headline), 'width:100%;height:360px;object-fit:cover;border-radius:16px;') + '</div>' +
                '</div>';
            let grid = '<div style="max-width:1200px;margin:0 auto;padding:clamp(40px,6vw,72px) clamp(16px,4vw,40px);">' +
                '<h2 style="font-family:' + df + ';font-size:1.8rem;font-weight:700;color:' + pal.p + ';margin-bottom:32px;">Featured</h2>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:clamp(16px,3vw,28px);">';
            sects.forEach(sec => {
                const price = '$' + (_ri(rng, 19, 299)) + '.99';
                grid += '<div style="border-radius:12px;overflow:hidden;background:' + pal.bg + ';box-shadow:0 2px 14px rgba(0,0,0,.07);">' +
                    latentImg('product photograph for ' + esc(sec.heading), 'width:100%;height:220px;object-fit:cover;') +
                    '<div style="padding:18px;">' +
                    '<h3 style="font-family:' + bf + ';font-size:.95rem;font-weight:600;color:' + pal.tx + ';margin-bottom:6px;">' + esc(sec.heading) + '</h3>' +
                    '<p style="font-family:' + bf + ';font-size:.82rem;color:' + pal.tx + ';opacity:.6;margin-bottom:12px;">' + esc((sec.body||'').substring(0,80)) + '</p>' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                    '<span style="font-family:' + df + ';font-size:1.1rem;font-weight:700;color:' + pal.p + ';">' + price + '</span>' +
                    '<a href="#" style="font-family:' + bf + ';font-size:.78rem;font-weight:600;background:' + pal.p + ';color:#fff;text-decoration:none;padding:7px 16px;border-radius:6px;">Add</a></div></div></div>';
            });
            grid += '</div></div>';
            return wrapDoc(nav, banner + grid, footer('dark-multi'), '');
        }

        if (layout === 'landing') {
            const nav = navBar('dark');
            const heroHtml =
                '<div style="position:relative;min-height:520px;display:flex;align-items:center;overflow:hidden;">' +
                latentImg('cinematic wide photograph for ' + esc(hero.headline), 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;') +
                '<div style="position:absolute;inset:0;background:linear-gradient(135deg,' + pal.p + 'ee,' + pal.p + '88);"></div>' +
                '<div style="position:relative;z-index:1;padding:clamp(48px,7vw,96px) clamp(16px,5vw,60px);max-width:640px;">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.2rem,5vw,3.8rem);font-weight:900;color:#fff;line-height:1.1;margin-bottom:20px;letter-spacing:-.02em;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.82);font-size:1.05rem;line-height:1.7;margin-bottom:32px;">' + esc(hero.sub) + '</p>' +
                '<a href="#" style="display:inline-block;font-family:' + bf + ';background:' + pal.acc + ';color:#fff;text-decoration:none;padding:13px 32px;border-radius:5px;font-weight:700;">Get Started</a>' +
                '</div></div>';
            let rows = '';
            sects.forEach((sec, i) => {
                const even = i%2===0;
                rows += '<div style="padding:clamp(48px,6vw,80px) clamp(16px,5vw,60px);background:' + (i%2===0 ? pal.bg : pal.s) + ';">' +
                    '<div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:clamp(32px,5vw,72px);align-items:center;">' +
                    (even
                        ? '<div>' + latentImg('photograph for ' + esc(sec.heading), 'width:100%;height:300px;object-fit:cover;border-radius:8px;') + '</div><div>'
                        : '<div>') +
                    '<h2 style="font-family:' + df + ';font-size:clamp(1.5rem,3vw,2.2rem);font-weight:700;color:' + pal.p + ';margin-bottom:16px;">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:.97rem;line-height:1.8;color:' + pal.tx + ';">' + paras(sec.body) + '</div>' +
                    (!even ? '</div><div>' + latentImg('photograph for ' + esc(sec.heading), 'width:100%;height:300px;object-fit:cover;border-radius:8px;') + '</div>' : '</div>') +
                    '</div></div>';
            });
            return wrapDoc(nav, heroHtml + rows, footer('dark-multi'), '');
        }

        if (layout === 'academic') {
            const nav = navBar('border');
            let main = '<div style="max-width:1050px;margin:0 auto;padding:clamp(40px,5vw,72px) clamp(16px,4vw,40px);display:grid;grid-template-columns:3fr 1fr;gap:clamp(32px,4vw,56px);align-items:start;">' +
                '<article>' +
                '<p style="font-family:' + bf + ';font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;font-weight:600;color:' + pal.acc + ';margin-bottom:12px;">Academic Review &bull; ' + new Date().getFullYear() + '</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(1.8rem,3.5vw,2.5rem);font-weight:700;color:' + pal.p + ';margin-bottom:14px;line-height:1.2;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';font-style:italic;font-size:.95rem;color:' + pal.tx + ';opacity:.65;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid ' + pal.s + ';">' + esc(hero.sub) + '</p>';
            sects.forEach((sec, i) => {
                main += '<h2 style="font-family:' + df + ';font-size:1.3rem;font-weight:700;color:' + pal.p + ';margin:32px 0 12px;">' + (i+1) + '. ' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:.95rem;line-height:1.9;color:' + pal.tx + ';">' + paras(sec.body) + '</div>';
                if (sec.quote) main += '<p style="font-family:' + df + ';font-style:italic;font-size:1.05rem;border-left:3px solid ' + pal.s + ';padding-left:18px;margin:24px 0;color:' + pal.tx + ';opacity:.75;">&ldquo;' + esc(sec.quote) + '&rdquo;</p>';
            });
            main += '</article>' +
                '<aside style="padding:24px;background:' + pal.s + ';border-radius:8px;position:sticky;top:80px;">' +
                '<p style="font-family:' + bf + ';font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:' + pal.p + ';margin-bottom:14px;">Abstract</p>' +
                '<p style="font-family:' + bf + ';font-size:.85rem;line-height:1.7;color:' + pal.tx + ';opacity:.8;">' + esc(hero.sub) + '</p>' +
                '<p style="font-family:' + bf + ';font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:' + pal.p + ';margin:24px 0 10px;">Keywords</p>' +
                navItems.map(n => '<span style="display:inline-block;font-family:' + bf + ';font-size:.72rem;background:' + pal.bg + ';border:1px solid ' + pal.p + ';color:' + pal.p + ';padding:3px 9px;border-radius:20px;margin:0 4px 6px 0;">' + esc(n) + '</span>').join('') +
                '</aside></div>';
            return wrapDoc(nav, main, footer('minimal'), '');
        }

        if (layout === 'tech-docs') {
            const bg2 = '#0e1117';
            const nav =
                '<nav style="background:' + bg2 + ';padding:0 clamp(16px,5vw,60px);position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;height:52px;border-bottom:1px solid #21262d;">' +
                '<span style="font-family:' + mf + ';font-size:.9rem;color:#58a6ff;">' + brand.toLowerCase().replace(/\s+/g,'-') + '</span>' +
                '<div style="display:flex;gap:20px;">' +
                navItems.map(n => '<a href="#" style="font-family:' + mf + ';color:#8b949e;font-size:.78rem;text-decoration:none;letter-spacing:.02em;">' + esc(n) + '</a>').join('') +
                '</div></nav>';
            let main = '<div style="background:' + bg2 + ';min-height:100vh;">' +
                '<div style="max-width:860px;margin:0 auto;padding:clamp(40px,6vw,72px) clamp(16px,4vw,40px);">' +
                '<h1 style="font-family:' + mf + ';font-size:clamp(1.6rem,3.5vw,2.5rem);color:#f0f6fc;margin-bottom:12px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + mf + ';font-size:.9rem;color:#8b949e;margin-bottom:40px;line-height:1.7;">' + esc(hero.sub) + '</p>';
            sects.forEach((sec, i) => {
                main += '<div style="margin-bottom:40px;padding:24px;background:#161b22;border:1px solid #21262d;border-radius:8px;">' +
                    '<h2 style="font-family:' + mf + ';font-size:1.05rem;color:#58a6ff;margin-bottom:14px;"># ' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + mf + ';font-size:.88rem;line-height:1.8;color:#c9d1d9;">' +
                    (sec.body||'').split('\n\n').filter(Boolean).map(p => '<p style="margin-bottom:.8em;">' + esc(p) + '</p>').join('') +
                    '</div></div>';
            });
            main += '</div></div>';
            return wrapDoc(nav, main, '<footer style="background:#0d1117;border-top:1px solid #21262d;padding:20px clamp(16px,5vw,60px);"><span style="font-family:' + mf + ';font-size:.75rem;color:#484f58;">' + ftxt + '</span></footer>', 'body{background:' + bg2 + ';}');
        }

        if (layout === 'magazine-cover') {
            const nav = navBar('dark');
            const cover =
                '<div style="position:relative;min-height:600px;display:flex;align-items:flex-end;overflow:hidden;background:' + pal.p + ';">' +
                latentImg('dramatic magazine cover photograph for ' + esc(hero.headline), 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.5;') +
                '<div style="position:relative;z-index:1;padding:clamp(32px,5vw,72px) clamp(16px,5vw,60px);width:100%;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:20px;">' +
                '<div style="max-width:700px;">' +
                '<p style="font-family:' + bf + ';text-transform:uppercase;letter-spacing:.18em;font-size:.68rem;font-weight:700;color:' + pal.acc + ';margin-bottom:16px;">' + esc(navItems[0]||'Feature') + '</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(3rem,7vw,6rem);font-weight:900;color:#fff;line-height:.92;letter-spacing:-.03em;margin-bottom:16px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.75);font-size:1.05rem;line-height:1.6;">' + esc(hero.sub) + '</p></div>' +
                '</div></div></div>';
            let strip = '<div style="background:' + pal.bg + ';padding:clamp(32px,5vw,56px) clamp(16px,4vw,40px);">' +
                '<div style="max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:clamp(20px,3vw,36px);">';
            sects.forEach((sec, i) => {
                strip += '<div style="' + (i===0 ? 'grid-column:span 2;' : '') + '">' +
                    '<p style="font-family:' + bf + ';font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;color:' + pal.acc + ';margin-bottom:8px;">' + esc(navItems[i%navItems.length]||'') + '</p>' +
                    '<h3 style="font-family:' + df + ';font-size:' + (i===0 ? '1.5rem' : '1.1rem') + ';font-weight:700;color:' + pal.p + ';margin-bottom:10px;line-height:1.2;">' + esc(sec.heading) + '</h3>' +
                    '<p style="font-family:' + bf + ';font-size:.88rem;line-height:1.7;color:' + pal.tx + ';opacity:.75;">' + esc((sec.body||'').substring(0,160)) + '</p></div>';
            });
            strip += '</div></div>';
            return wrapDoc(nav, cover + strip, footer('dark-multi'), '');
        }

        if (layout === 'travel-blog') {
            const nav = navBar('transparent-dark');
            let main = '';
            const heroH =
                '<div style="position:relative;min-height:600px;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;">' +
                latentImg('travel landscape photograph for ' + esc(hero.headline), 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;') +
                '<div style="position:absolute;inset:0;background:rgba(0,0,0,.45);"></div>' +
                '<div style="position:relative;z-index:1;padding:clamp(32px,5vw,72px) clamp(16px,5vw,60px);">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.5rem,6vw,5rem);font-weight:900;color:#fff;line-height:1.05;letter-spacing:-.02em;margin-bottom:18px;text-shadow:0 2px 20px rgba(0,0,0,.3);">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.88);font-size:1.1rem;line-height:1.6;max-width:560px;margin:0 auto;">' + esc(hero.sub) + '</p></div></div>';
            main += heroH;
            sects.forEach((sec, i) => {
                if (i%2===0) {
                    main += '<div style="position:relative;min-height:420px;display:flex;align-items:flex-end;overflow:hidden;">' +
                        latentImg('travel photograph for ' + esc(sec.heading), 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;') +
                        '<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.75) 0%,transparent 50%);"></div>' +
                        '<div style="position:relative;z-index:1;padding:clamp(28px,4vw,56px) clamp(16px,5vw,60px);max-width:680px;">' +
                        '<h2 style="font-family:' + df + ';font-size:clamp(1.6rem,3vw,2.4rem);font-weight:900;color:#fff;margin-bottom:12px;">' + esc(sec.heading) + '</h2>' +
                        '<p style="font-family:' + bf + ';color:rgba(255,255,255,.82);font-size:.97rem;line-height:1.7;">' + esc((sec.body||'').substring(0,250)) + '</p></div></div>';
                } else {
                    main += '<div style="max-width:740px;margin:0 auto;padding:clamp(48px,6vw,72px) clamp(16px,4vw,0px);">' +
                        '<h2 style="font-family:' + df + ';font-size:1.8rem;font-weight:700;color:' + pal.p + ';margin-bottom:16px;">' + esc(sec.heading) + '</h2>' +
                        '<div style="font-family:' + bf + ';font-size:1rem;line-height:1.85;color:' + pal.tx + ';">' + paras(sec.body) + '</div></div>';
                }
            });
            const topNav =
                '<nav style="position:absolute;top:0;left:0;right:0;z-index:50;padding:0 clamp(16px,5vw,60px);height:60px;display:flex;align-items:center;justify-content:space-between;">' +
                '<span style="font-family:' + df + ';font-weight:700;font-size:1.1rem;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.4);">' + brand + '</span>' +
                '<div style="display:flex;gap:24px;">' +
                navItems.map(n => '<a href="#" style="font-family:' + bf + ';color:rgba(255,255,255,.85);font-size:.85rem;text-decoration:none;text-shadow:0 1px 6px rgba(0,0,0,.4);">' + esc(n) + '</a>').join('') +
                '</div></nav>';
            return wrapDoc('', '<div style="position:relative;">' + topNav + main + '</div>', footer('dark-multi'), 'body{background:' + pal.bg + ';}');
        }

        if (layout === 'luxury') {
            const cream = '#faf8f3';
            const gold  = '#b8963e';
            const dark  = '#1a1610';
            const nav =
                '<nav style="background:' + cream + ';padding:0 clamp(16px,5vw,80px);height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ' + gold + '33;">' +
                '<span style="font-family:' + df + ';font-weight:400;font-size:1.3rem;color:' + dark + ';letter-spacing:.08em;">' + brand.toUpperCase() + '</span>' +
                '<div style="display:flex;gap:36px;">' +
                navItems.map(n => '<a href="#" style="font-family:' + bf + ';color:' + dark + ';font-size:.78rem;font-weight:300;text-transform:uppercase;letter-spacing:.12em;text-decoration:none;opacity:.7;">' + esc(n) + '</a>').join('') +
                '</div></nav>';
            let main = '<div style="background:' + cream + ';">' +
                '<div style="text-align:center;padding:clamp(72px,10vw,130px) clamp(16px,5vw,60px);border-bottom:1px solid ' + gold + '44;">' +
                '<p style="font-family:' + bf + ';font-size:.68rem;text-transform:uppercase;letter-spacing:.25em;color:' + gold + ';margin-bottom:28px;">' + esc(navItems[0]||'Est. 2024') + '</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.5rem,6vw,5rem);font-weight:400;color:' + dark + ';line-height:1.1;letter-spacing:-.01em;margin-bottom:28px;">' + esc(hero.headline) + '</h1>' +
                '<div style="width:48px;height:1px;background:' + gold + ';margin:0 auto 28px;"></div>' +
                '<p style="font-family:' + bf + ';font-size:1rem;color:' + dark + ';opacity:.6;line-height:1.8;max-width:480px;margin:0 auto;">' + esc(hero.sub) + '</p></div>';
            sects.forEach((sec, i) => {
                const even = i%2===0;
                main += '<div style="display:grid;grid-template-columns:1fr 1fr;background:' + (i%2===0 ? cream : '#f0ede5') + ';">' +
                    (even ? '' : '<div>' + latentImg('luxury product photograph for ' + esc(sec.heading), 'width:100%;height:100%;object-fit:cover;min-height:400px;') + '</div>') +
                    '<div style="display:flex;align-items:center;padding:clamp(48px,6vw,88px) clamp(24px,5vw,72px);">' +
                    '<div><p style="font-family:' + bf + ';font-size:.68rem;text-transform:uppercase;letter-spacing:.2em;color:' + gold + ';margin-bottom:16px;">' + String.fromCharCode(8212) + ' ' + esc(navItems[i%navItems.length]||'') + '</p>' +
                    '<h2 style="font-family:' + df + ';font-size:clamp(1.4rem,2.5vw,2rem);font-weight:400;color:' + dark + ';margin-bottom:18px;">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:.95rem;line-height:1.9;color:' + dark + ';opacity:.7;">' + paras(sec.body) + '</div></div></div>' +
                    (even ? '<div>' + latentImg('luxury photograph for ' + esc(sec.heading), 'width:100%;height:100%;object-fit:cover;min-height:400px;') + '</div>' : '') +
                    '</div>';
            });
            main += '</div>';
            return wrapDoc(nav, main, '<footer style="background:' + dark + ';padding:clamp(32px,4vw,56px) clamp(16px,5vw,60px);text-align:center;"><p style="font-family:' + bf + ';font-weight:300;letter-spacing:.2em;font-size:.7rem;text-transform:uppercase;color:' + gold + ';margin-bottom:12px;">' + brand.toUpperCase() + '</p><p style="font-family:' + bf + ';font-size:.72rem;color:rgba(255,255,255,.3);">' + ftxt + '</p></footer>', 'body{background:' + cream + ';}');
        }

        if (layout === 'nonprofit') {
            const nav = navBar('tall');
            const heroHtml =
                '<div style="background:' + pal.p + ';padding:clamp(56px,8vw,100px) clamp(16px,5vw,60px);text-align:center;">' +
                '<p style="font-family:' + bf + ';text-transform:uppercase;letter-spacing:.14em;font-size:.7rem;font-weight:700;color:' + pal.acc + ';margin-bottom:18px;">Our Mission</p>' +
                '<h1 style="font-family:' + df + ';font-size:clamp(2.2rem,5vw,3.8rem);font-weight:900;color:#fff;line-height:1.1;max-width:760px;margin:0 auto 24px;letter-spacing:-.01em;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.78);font-size:1.05rem;line-height:1.7;max-width:560px;margin:0 auto;">' + esc(hero.sub) + '</p></div>';
            const stats =
                '<div style="background:' + pal.acc + ';padding:clamp(32px,4vw,56px) clamp(16px,5vw,60px);">' +
                '<div style="max-width:1000px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;text-align:center;">' +
                ['10,000+','94%','50+','$2M+'].map((n, i) =>
                    '<div><p style="font-family:' + df + ';font-size:2.5rem;font-weight:900;color:#fff;line-height:1;">' + n + '</p>' +
                    '<p style="font-family:' + bf + ';font-size:.82rem;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.08em;margin-top:8px;">' + esc(navItems[i]||'People Helped') + '</p></div>'
                ).join('') +
                '</div></div>';
            let content = '<div style="max-width:1000px;margin:0 auto;padding:clamp(48px,6vw,80px) clamp(16px,4vw,40px);">';
            sects.forEach((sec, i) => {
                content += '<div style="display:grid;grid-template-columns:' + (sec.has_image ? '1fr 1fr' : '1fr') + ';gap:40px;align-items:center;margin-bottom:60px;padding-bottom:60px;border-bottom:1px solid ' + pal.s + ';">' +
                    '<div><h2 style="font-family:' + df + ';font-size:1.6rem;font-weight:700;color:' + pal.p + ';margin-bottom:16px;">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:.97rem;line-height:1.85;color:' + pal.tx + ';">' + paras(sec.body) + '</div></div>' +
                    (sec.has_image ? '<div>' + latentImg('human impact photograph for ' + esc(sec.heading), 'width:100%;height:280px;object-fit:cover;border-radius:10px;') + '</div>' : '') +
                    '</div>';
            });
            content += '</div>';
            return wrapDoc(nav, heroHtml + stats + content, footer('dark-multi'), '');
        }

        if (layout === 'news-ticker') {
            const nav = navBar('dark');
            const ticker =
                '<div style="background:' + pal.acc + ';padding:7px clamp(16px,5vw,60px);overflow:hidden;">' +
                '<div style="white-space:nowrap;"><span style="font-family:' + bf + ';font-size:.75rem;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.08em;margin-right:32px;">Breaking</span>' +
                sects.map(s => '<span style="font-family:' + bf + ';font-size:.75rem;color:#fff;margin-right:48px;">' + esc(s.heading) + ' &nbsp;&bull;</span>').join('') +
                '</div></div>';
            const heroH =
                '<div style="background:' + pal.p + ';padding:clamp(40px,6vw,80px) clamp(16px,5vw,60px);">' +
                '<div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:5fr 2fr;gap:40px;align-items:start;">' +
                '<div>' + latentImg('news photograph for ' + esc(hero.headline), 'width:100%;height:320px;object-fit:cover;margin-bottom:20px;') +
                '<h1 style="font-family:' + df + ';font-size:clamp(1.8rem,3.5vw,2.8rem);font-weight:900;color:#fff;line-height:1.1;margin-bottom:12px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';color:rgba(255,255,255,.7);font-size:.95rem;line-height:1.65;">' + esc(hero.sub) + '</p></div>' +
                '<div>' + sects.slice(0,3).map(sec =>
                    '<div style="padding:16px 0;border-bottom:1px solid rgba(255,255,255,.15);">' +
                    '<h3 style="font-family:' + df + ';font-size:1rem;color:#fff;margin-bottom:6px;font-weight:700;">' + esc(sec.heading) + '</h3>' +
                    '<p style="font-family:' + bf + ';font-size:.8rem;color:rgba(255,255,255,.55);line-height:1.6;">' + esc((sec.body||'').substring(0,100)) + '</p></div>'
                ).join('') + '</div></div></div>';
            let timeline = '<div style="max-width:760px;margin:0 auto;padding:clamp(40px,5vw,64px) clamp(16px,4vw,0px);">';
            sects.forEach((sec, i) => {
                const tDate = new Date(Date.now() - i * 86400000 * 2).toLocaleDateString('en-US',{month:'short',day:'numeric'});
                timeline += '<div style="display:grid;grid-template-columns:60px 1fr;gap:20px;margin-bottom:36px;">' +
                    '<div style="text-align:right;padding-top:4px;">' +
                    '<span style="font-family:' + bf + ';font-size:.7rem;color:' + pal.p + ';font-weight:700;display:block;">' + tDate + '</span>' +
                    '<div style="width:8px;height:8px;border-radius:50%;background:' + pal.acc + ';margin:8px 0 0 auto;"></div></div>' +
                    '<div style="border-left:2px solid ' + pal.s + ';padding-left:20px;">' +
                    '<h3 style="font-family:' + df + ';font-size:1.15rem;font-weight:700;color:' + pal.p + ';margin-bottom:8px;">' + esc(sec.heading) + '</h3>' +
                    '<div style="font-family:' + bf + ';font-size:.9rem;line-height:1.75;color:' + pal.tx + ';">' + paras(sec.body) + '</div></div></div>';
            });
            timeline += '</div>';
            return wrapDoc(nav, ticker + heroH + timeline, footer('dark-multi'), '');
        }

        if (layout === 'brutalist') {
            const c1 = pal.p, c2 = pal.acc, ctx = '#fff';
            const nav =
                '<nav style="background:' + c1 + ';border-bottom:4px solid ' + c2 + ';padding:0 clamp(16px,5vw,60px);height:64px;display:flex;align-items:center;justify-content:space-between;">' +
                '<span style="font-family:' + df + ';font-weight:900;font-size:1.4rem;color:#fff;text-transform:uppercase;letter-spacing:.02em;">' + brand + '</span>' +
                '<div style="display:flex;gap:0;">' +
                navItems.map((n, i) => '<a href="#" style="font-family:' + bf + ';font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:#fff;text-decoration:none;padding:0 18px;border-left:2px solid rgba(255,255,255,.2);opacity:.85;">' + esc(n) + '</a>').join('') +
                '</div></nav>';
            const heroHtml2 =
                '<div style="background:' + c1 + ';padding:clamp(48px,7vw,96px) clamp(16px,5vw,60px);border-bottom:6px solid ' + c2 + ';">' +
                '<h1 style="font-family:' + df + ';font-size:clamp(3rem,8vw,7rem);font-weight:900;color:#fff;line-height:.9;letter-spacing:-.03em;text-transform:uppercase;margin-bottom:24px;">' + esc(hero.headline) + '</h1>' +
                '<p style="font-family:' + bf + ';font-size:1.1rem;color:rgba(255,255,255,.65);max-width:560px;line-height:1.6;">' + esc(hero.sub) + '</p>' +
                '</div>';
            let blocks = '';
            sects.forEach((sec, i) => {
                const even = i%2===0;
                const bg3 = even ? pal.bg : pal.s;
                blocks += '<div style="background:' + bg3 + ';border-bottom:4px solid ' + c1 + ';padding:clamp(32px,5vw,64px) clamp(16px,5vw,60px);' + (even ? '' : 'border-left:8px solid ' + c2 + ';') + '">' +
                    '<div style="max-width:1100px;margin:0 auto;">' +
                    '<span style="font-family:' + bf + ';font-size:.7rem;font-weight:900;text-transform:uppercase;letter-spacing:.15em;color:' + c2 + ';display:block;margin-bottom:12px;">— ' + String(i+1).padStart(2,'0') + '</span>' +
                    '<h2 style="font-family:' + df + ';font-size:clamp(2rem,4vw,3.2rem);font-weight:900;color:' + c1 + ';text-transform:uppercase;margin-bottom:18px;letter-spacing:-.01em;">' + esc(sec.heading) + '</h2>' +
                    '<div style="font-family:' + bf + ';font-size:1rem;line-height:1.75;color:' + pal.tx + ';max-width:680px;">' + paras(sec.body) + '</div>' +
                    (sec.quote ? '<p style="font-family:' + df + ';font-size:1.4rem;font-weight:700;color:' + c2 + ';margin-top:24px;font-style:italic;">&ldquo;' + esc(sec.quote) + '&rdquo;</p>' : '') +
                    '</div></div>';
            });
            return wrapDoc(nav, heroHtml2 + blocks, '<footer style="background:' + c2 + ';border-top:4px solid ' + c1 + ';padding:clamp(20px,3vw,36px) clamp(16px,5vw,60px);display:flex;justify-content:space-between;align-items:center;"><span style="font-family:' + df + ';font-weight:900;font-size:1.1rem;color:#fff;text-transform:uppercase;">' + brand + '</span><span style="font-family:' + bf + ';font-size:.8rem;color:rgba(255,255,255,.7);">' + ftxt + '</span></footer>', '');
        }

        // FALLBACK → classic-blog variant of any unmatched layout
        const navFb = navBar('dark');
        let mainFb = '<div style="max-width:760px;margin:0 auto;padding:clamp(48px,6vw,80px) clamp(16px,4vw,0px);">' +
            '<h1 style="font-family:' + df + ';font-size:clamp(2rem,5vw,3.4rem);font-weight:900;color:' + pal.p + ';line-height:1.1;margin-bottom:20px;">' + esc(hero.headline) + '</h1>' +
            '<p style="font-family:' + bf + ';font-size:1.05rem;color:' + pal.tx + ';opacity:.7;margin-bottom:36px;line-height:1.7;">' + esc(hero.sub) + '</p>' +
            latentImg('photograph for ' + esc(hero.headline), 'width:100%;height:380px;object-fit:cover;margin-bottom:40px;');
        sects.forEach(sec => {
            mainFb += '<h2 style="font-family:' + df + ';font-size:1.7rem;font-weight:700;color:' + pal.p + ';margin:36px 0 14px;">' + esc(sec.heading) + '</h2>' +
                '<div style="font-family:' + bf + ';font-size:1rem;line-height:1.8;color:' + pal.tx + ';">' + paras(sec.body) + '</div>';
        });
        mainFb += '</div>';
        return wrapDoc(navFb, mainFb, footer('minimal'), '');
    }
    // ── End template engine ─────────────────────────────────────────────────

    function openPageViewer(url, title, snippet) {
        history.push({ url, title, snippet });
        backBtn.disabled = history.length <= 1;

        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        urlTextEl.textContent = url;
        faviconEl.textContent = '\uD83D\uDD12';

        // ── Cache hit: show instantly ──
        if (pageCache.has(url)) {
            const cached = pageCache.get(url);
            faviconEl.classList.remove('loading');
            progressBar.style.display = 'none';
            // srcdoc was blanked on close, so setting it now always triggers a real reload
            iframe.srcdoc = cached.finalHtml;
            iframe.onload = () => {
                iframe.onload = null;
                hydrateLazyImages(cached.finalHtml);
            };
            return;
        }

        // ── Cache miss: fetch JSON content, build seeded template ──
        currentUrl = url;
        currentRawBuffer = '';
        iframe.srcdoc = '';
        startProgress();

        if (activeEs) { activeEs.close(); activeEs = null; }

        const ctrl = new AbortController();
        activeEs = { close: () => ctrl.abort() };

        const params = new URLSearchParams({ url, title, snippet });
        fetch((window.API_BASE || '') + `/api/page/content?${params}`, { signal: ctrl.signal })
            .then(r => r.json())
            .then(result => {
                activeEs = null;
                if (result.error) throw new Error(result.error);
                const html = buildSeededPage(url, result.content || {});
                pageCache.set(url, { finalHtml: html });
                iframe.srcdoc = html;
                iframe.onload = () => {
                    iframe.onload = null;
                    hydrateLazyImages(html);
                };
                finishProgress();
            })
            .catch(err => {
                activeEs = null;
                if (err.name === 'AbortError') return;
                finishProgress();
                iframe.srcdoc = '<html><body style="font-family:sans-serif;padding:40px;color:#ea4335;"><h2>Could not load page</h2><p>' + err.message + '</p></body></html>';
            });
    }

        closeBtn.onclick = closeViewer;
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });

    backBtn.onclick = () => {
        if (history.length > 1) {
            history.pop();
            const prev = history[history.length - 1];
            history.pop();
            openPageViewer(prev.url, prev.title, prev.snippet);
        }
    };

    // Delegate clicks on result titles
    document.addEventListener('click', (e) => {
        const title = e.target.closest('.result-link');
        if (!title) return;
        const item = title.closest('[data-result-url]');
        if (!item) return;
        e.preventDefault();
        const url     = item.dataset.resultUrl || '';
        const t       = item.dataset.resultTitle || '';
        const snippet = item.dataset.resultSnippet || '';
        // Mark as visited immediately
        visitedUrls.add(url);
        title.classList.add('visited');
        openPageViewer(url, t, snippet);
    });
})();