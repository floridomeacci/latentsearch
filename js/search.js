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
        const response = await fetch((window.API_BASE || '') + '/api/search', {
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
        const es = new EventSource((window.API_BASE || '') + `/api/images/stream?${params}`);
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

    const _FONTS = [
        { d: 'Playfair Display',   b: 'Source Serif 4',  gf: 'Playfair+Display:wght@700;900&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;1,8..60,400&display=swap' },
        { d: 'DM Serif Display',   b: 'DM Sans',         gf: 'DM+Serif+Display&family=DM+Sans:wght@300;400;500&display=swap' },
        { d: 'Fraunces',           b: 'Epilogue',        gf: 'Fraunces:ital,opsz,wght@0,9..144,700;0,9..144,900&family=Epilogue:wght@300;400;500&display=swap' },
        { d: 'Cormorant Garamond', b: 'Jost',            gf: 'Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Jost:wght@300;400;500&display=swap' },
        { d: 'Space Grotesk',      b: 'Space Grotesk',   gf: 'Space+Grotesk:wght@300;400;500;600;700&display=swap' },
        { d: 'Libre Baskerville',  b: 'Libre Franklin',  gf: 'Libre+Baskerville:ital,wght@0,700;1,400&family=Libre+Franklin:wght@400;500;600&display=swap' },
        { d: 'Syne',               b: 'Syne',            gf: 'Syne:wght@400;600;700;800&display=swap' },
        { d: 'Unbounded',          b: 'Outfit',          gf: 'Unbounded:wght@600;700;900&family=Outfit:wght@300;400;500&display=swap' },
    ];
    const _PALETTES = [
        { p: '#1a3a2a', bg: '#f5f2ed', acc: '#c9963a', tx: '#1a1a1a', s: '#dfe9de' },
        { p: '#7a1e28', bg: '#fdf8f5', acc: '#c17f24', tx: '#1a0a08', s: '#fbe8e4' },
        { p: '#1c3557', bg: '#f2f6fb', acc: '#e8792a', tx: '#0f1923', s: '#ddeaf7' },
        { p: '#2d4a3e', bg: '#f6f9f4', acc: '#88b04b', tx: '#1a1f18', s: '#e1eedd' },
        { p: '#5c2d91', bg: '#f8f4ff', acc: '#e8a030', tx: '#1a0f2e', s: '#e8dcf7' },
        { p: '#8a3500', bg: '#fdf5ee', acc: '#3d9e8a', tx: '#1f0e00', s: '#fde5cc' },
        { p: '#0d3b4f', bg: '#edf7fb', acc: '#f0a500', tx: '#0a1e28', s: '#c8e8f5' },
        { p: '#1f1f1f', bg: '#f8f8f6', acc: '#c0392b', tx: '#1f1f1f', s: '#eeeeec' },
    ];

    function buildSeededPage(urlStr, c) {
        const rng    = _rng(_strSeed(urlStr));
        const font   = _pick(rng, _FONTS);
        const pal    = _pick(rng, _PALETTES);
        const layout = _pick(rng, ['default', 'wide', 'editorial']);
        const heroH  = _pick(rng, [340, 400, 480]);
        const cw     = layout === 'wide' ? '1100px' : '760px';
        const esc    = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const paras  = b => (b || '').split(/\n\n+/).filter(Boolean).map(p => '<p>' + esc(p) + '</p>').join('');

        const brand  = esc(c.brand  || 'Site');
        const nav    = (c.nav || ['Home', 'About', 'Articles', 'Topics', 'Contact']).slice(0, 5);
        const hero   = c.hero || { headline: brand, sub: '' };
        const sects  = Array.isArray(c.sections) ? c.sections : [];
        const ftxt   = esc(c.footer || '\u00a9 2026 ' + brand);
        const df     = "'" + font.d + "',Georgia,serif";
        const bf     = "'" + font.b + "',system-ui,sans-serif";

        const navHtml =
            '<nav style="background:' + pal.p + ';padding:0 clamp(16px,5vw,60px);position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;height:58px;gap:24px;">' +
            '<span style="font-family:' + df + ';font-weight:700;font-size:1.05rem;color:#fff;letter-spacing:-.01em;">' + brand + '</span>' +
            '<div style="display:flex;gap:clamp(12px,2.5vw,32px);">' +
            nav.map(n => '<a href="#" style="font-family:' + bf + ';color:rgba(255,255,255,.82);font-size:.875rem;text-decoration:none;">' + esc(n) + '</a>').join('') +
            '</div></nav>';

        let imgIdx = 0;
        const heroImg = '<img src="" data-latent-img="cinematic hero photograph for ' + esc(hero.headline) + '" data-latent-idx="' + (imgIdx++) + '" alt="hero" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38;">';
        const heroHtml =
            '<header style="position:relative;background:' + pal.p + ';min-height:' + heroH + 'px;display:flex;align-items:flex-end;overflow:hidden;">' +
            heroImg +
            '<div style="position:relative;z-index:1;padding:clamp(32px,6vw,76px) clamp(16px,5vw,60px);max-width:820px;">' +
            '<h1 style="font-family:' + df + ';font-size:clamp(2rem,5vw,3.4rem);font-weight:900;color:#fff;line-height:1.1;margin:0 0 14px;letter-spacing:-.02em;">' + esc(hero.headline) + '</h1>' +
            (hero.sub ? '<p style="font-family:' + bf + ';color:rgba(255,255,255,.85);font-size:clamp(.95rem,2vw,1.15rem);line-height:1.6;margin:0;max-width:560px;">' + esc(hero.sub) + '</p>' : '') +
            '</div></header>';

        let secHtml = '';
        sects.forEach(function (sec, i) {
            const secBg  = (i % 3 === 2) ? pal.s : pal.bg;
            const hasImg = !!sec.has_image;
            const ci     = imgIdx;
            if (hasImg) imgIdx++;
            const imgTag = hasImg
                ? '<img src="" data-latent-img="editorial photograph for ' + esc(sec.heading) + '" data-latent-idx="' + ci + '" alt="' + esc(sec.heading) + '" style="width:100%;height:260px;object-fit:cover;border-radius:8px;display:block;">'
                : '';
            const quote  = sec.quote
                ? '<blockquote style="border-left:3px solid ' + pal.acc + ';margin:28px 0;padding:12px 20px;font-family:' + df + ';font-size:1.15rem;font-style:italic;color:' + pal.p + ';line-height:1.55;">' + esc(sec.quote) + '</blockquote>'
                : '';
            const h2   = '<h2 style="font-family:' + df + ';font-size:clamp(1.3rem,2.5vw,1.9rem);font-weight:700;color:' + pal.tx + ';margin:0 0 18px;">' + esc(sec.heading) + '</h2>';
            const body = '<div style="font-family:' + bf + ';font-size:1rem;line-height:1.75;color:' + pal.tx + ';">' + paras(sec.body) + '</div>';

            if (hasImg && layout === 'default') {
                const ir = i % 2 === 0;
                secHtml +=
                    '<section style="background:' + secBg + ';padding:clamp(40px,6vw,80px) clamp(16px,5vw,60px);">' +
                    '<div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:clamp(24px,4vw,56px);align-items:start;">' +
                    (ir ? '<div>' + imgTag + '</div><div>' + h2 + body + '</div>' : '<div>' + h2 + body + '</div><div>' + imgTag + '</div>') +
                    '</div></section>';
            } else {
                secHtml +=
                    '<section style="background:' + secBg + ';padding:clamp(40px,6vw,80px) clamp(16px,5vw,60px);">' +
                    '<div style="max-width:' + cw + ';margin:0 auto;">' + h2 +
                    (hasImg ? '<div style="margin:0 0 28px;">' + imgTag + '</div>' : '') +
                    body + quote + '</div></section>';
            }
        });

        const footerHtml =
            '<footer style="background:' + pal.p + ';padding:clamp(24px,4vw,48px) clamp(16px,5vw,60px);margin-top:auto;">' +
            '<div style="max-width:1100px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">' +
            '<span style="font-family:' + df + ';font-weight:700;color:#fff;">' + brand + '</span>' +
            '<span style="font-family:' + bf + ';color:rgba(255,255,255,.6);font-size:.85rem;">' + ftxt + '</span>' +
            '</div></footer>';

        // Split </script> to prevent parser confusion
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

        const css =
            '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}' +
            'html,body{height:100%;}' +
            'body{min-height:100vh;display:flex;flex-direction:column;background:' + pal.bg + ';color:' + pal.tx + ';}' +
            'main{flex:1;}p{margin-bottom:1em;}p:last-child{margin-bottom:0;}' +
            'img[src=""]{background:' + pal.s + ';}';

        return '<!DOCTYPE html>\n<html lang="en"><head>' +
            '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<link rel="preconnect" href="https://fonts.googleapis.com">' +
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
            '<link href="https://fonts.googleapis.com/css2?family=' + font.gf + '" rel="stylesheet">' +
            '<style>' + css + '</style>' +
            '</head><body>\n' + navHtml + '\n' + heroHtml + '\n<main>' + secHtml + '</main>\n' + footerHtml + '\n' + inlineScript + '\n</body></html>';
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