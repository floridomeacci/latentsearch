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
    if (statsEl) statsEl.textContent = '';
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

    try {
        const startTime = performance.now();
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, page }),
        });
        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (parseErr) {
            throw new Error('Invalid JSON response from server');
        }
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        if (!response.ok) {
            const serverError = (data && data.error) ? data.error : `Request failed (${response.status})`;
            if (resultsEl) {
                resultsEl.innerHTML = `<p style="color:#ea4335;padding:20px 0;">Error: ${escapeHtml(serverError)}</p>`;
            }
            return;
        }

        if (data.error) {
            if (resultsEl) {
                resultsEl.innerHTML = `<p style="color:#ea4335;padding:20px 0;">Error: ${escapeHtml(data.error)}</p>`;
            }
            return;
        }

        const results = normalizeSearchResults(data);
        const imageHighlights = Array.isArray(data.imageHighlights) ? data.imageHighlights.slice(0, 3) : [];

        if (!Array.isArray(results) || results.length === 0) {
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
        const es = new EventSource(`/api/images/stream?${params}`);
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

        es.onerror = () => {
            es.close();
            skeletonEls.slice(localIdx).forEach(s => s.remove());
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
        // Crawl to 85% over ~12s, simulating slow load
        requestAnimationFrame(() => {
            progressFill.style.transition = 'width 12s cubic-bezier(0.1,0.4,0.6,1)';
            progressFill.style.width = '85%';
        });
    }

    function finishProgress() {
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
                hydrateLazyImages(cached.rawBuffer);
            };
            return;
        }

        // ── Cache miss: stream from API ──
        currentUrl = url;
        currentRawBuffer = '';
        iframe.srcdoc = '';
        startProgress();

        if (activeEs) { activeEs.close(); activeEs = null; }

        const params = new URLSearchParams({ url, title, snippet });
        const es = new EventSource(`/api/page/stream?${params}`);
        activeEs = es;

        let htmlBuffer = '';

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.error) {
                    es.close(); activeEs = null;
                    finishProgress();
                    iframe.srcdoc = `<html><body style="font-family:sans-serif;padding:40px;color:#ea4335;">
                        <h2>Could not load page</h2><p>${data.error}</p></body></html>`;
                    return;
                }

                if (data.done) {
                    es.close(); activeEs = null;
                    let html = htmlBuffer.trim();
                    if (html.startsWith('\`\`\`')) {
                        html = html.replace(/^\`\`\`[a-z]*\n?/, '').replace(/\`\`\`\s*$/, '').trim();
                    }
                    // Tag each data-latent-img with a numeric index so the postMessage handler can find it
                    let imgIdx = 0;
                    html = html.replace(/(<img[^>]*data-latent-img="[^"]*"[^>]*)(>|\/?>)/g,
                        (m, before, end) => `${before} data-latent-idx="${imgIdx++}"${end}`);
                    // Inject postMessage listener + shimmer keyframe into the page
                    const listenerScript = `<script>
(function(){
  var style=document.createElement('style');
  style.textContent='html{height:100%;}body{min-height:100vh;height:100%;margin:0;display:flex;flex-direction:column;}body>main,body>[role=main]{flex:1 0 auto;}body>footer{margin-top:auto;flex-shrink:0;}@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
  document.head.appendChild(style);
  // Apply shimmer to all placeholders
  document.querySelectorAll('img[data-latent-img]').forEach(function(img){
    img.style.cssText+='background:linear-gradient(90deg,#e8eaed 25%,#f1f3f4 50%,#e8eaed 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;min-height:200px;';
  });
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='latent-img')return;
    var img=document.querySelector('img[data-latent-idx="'+e.data.idx+'"]');
    if(img){img.src=e.data.url;img.style.background='';img.style.animation='';img.style.minHeight='';}
  });
})();
<\/script>`;
                    html = html.replace('</body>', listenerScript + '</body>');
                    if (!html.includes('</body>')) html += listenerScript;
                    // ── Save to cache ──
                    pageCache.set(url, { finalHtml: html, rawBuffer: htmlBuffer });
                    iframe.srcdoc = html;
                    finishProgress();
                    hydrateLazyImages(htmlBuffer);
                    return;
                }

                if (data.token) {
                    htmlBuffer += data.token;
                    currentRawBuffer = htmlBuffer; // keep in sync for close-while-streaming
                }
            } catch (_e) { /* ignore */ }
        };

        es.onerror = () => {
            es.close(); activeEs = null;
            finishProgress();
            if (!htmlBuffer.trim()) {
                iframe.srcdoc = `<html><body style="font-family:sans-serif;padding:40px;color:#ea4335;">
                    <h2>Failed to load page</h2><p>Server may not be running.</p></body></html>`;
            } else {
                iframe.srcdoc = htmlBuffer;
            }
        };
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