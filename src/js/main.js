// ULTRA-RELIABLE TRADING VIEWER SCRIPT
document.addEventListener('DOMContentLoaded', function() {
// ===== CONFIGURATION ===== 
const CONFIG = {
  isLoading: false,
  api: {
    spot: 'https://api.binance.com/api/v3',
    futures: 'https://fapi.binance.com/fapi/v1',
    ws: 'wss://fstream.binance.com/ws/!ticker@arr'
    // Removed backupWs array
  },
  connection: {
    maxRetries: Infinity,       // Keep infinite retries
    baseDelay: 1000,           // Faster 1s initial retry (V3 advantage)
    maxDelay: 10000,           // Capped at 10s (better than V2's 60s)
    pingInterval: 0,           // Keep disabled (Binance doesn't need it)
    staleTimeout: 0            // Keep disabled
  },
  defaults: {
    visiblePairs: 20,
    totalPairs: 250,
    highlightStorageKey: 'highlightedPairsData', // Key for localStorage
    highlightTimerInterval: 1000, // Update timer every second
    pricePrecision: {          // Keep your original precision rules
      'BTC': 2, 'ETH': 2, 'BNB': 2, 'SOL': 2,
      'XRP': 4, 'ADA': 4, 'DOGE': 4,
      '_default': 4
    }
  }
};
    
// ===== MOBILE DETECTION =====
const isMobile = {
    Android: function() {
        return navigator.userAgent.match(/Android/i);
    },
    iOS: function() {
        return navigator.userAgent.match(/iPhone|iPad|iPod/i);
    },
    any: function() {
        return (isMobile.Android() || isMobile.iOS());
    }
};

    // ===== STATE MANAGEMENT =====
const state = {
    data: [],
    socket: null,
    currentWsUrl: CONFIG.api.ws,
    isPaused: false,
    pinnedPairs: JSON.parse(localStorage.getItem('pinnedPairs')) || [],
    highlightedPairs: JSON.parse(localStorage.getItem(CONFIG.defaults.highlightStorageKey)) || {},
    highlightTimers: {},
    sortDirection: {  // MOVED OUT OF CONNECTION OBJECT
        volume: 'desc',
        change: null
    },
    visibleCount: CONFIG.defaults.visiblePairs,
    pauseStartTime: null,
    pauseTimer: null,
    connection: {
        status: 'disconnected',
        retryCount: 0,
        lastUpdate: null,
        lastPing: null,
        pingInterval: null
    }
};

    // ===== DOM ELEMENTS =====
    const elements = {
        tableBody: document.getElementById('data'),
        searchButton: document.getElementById('searchButton'),
        loadingIndicator: document.getElementById('loading'),
        pauseButton: document.getElementById('pauseButton'),
        refreshButton: document.getElementById('refreshButton'),
        showMoreButton: document.getElementById('showMoreButton'),
        connectionStatus: document.getElementById('connectionIndicator'),
        sortHeader: document.getElementById('sortHeader'),
        pairDetailModal: document.getElementById('pair-detail-modal'),
        pairTitle: document.getElementById('pair-title'),
        pairPrice: document.getElementById('pair-price'),
        pairHigh: document.getElementById('pair-high'),
        pairLow: document.getElementById('pair-low'),
        pairVolume: document.getElementById('pair-volume'),
        pair24hChange: document.getElementById('pair-24h-change'),
        pair12hChange: document.getElementById('pair-12h-change'),
        searchInput: document.getElementById('searchInput'),
        searchContainer: document.querySelector('.search-container'),
        searchResults: document.getElementById('searchResults'),
    };
    
// ===== FORMATTER =====
const formatter = {
    price: (value, symbol) => {
        const numValue = parseFloat(value);
        const base = symbol.replace('USDT', '');
        
        // Dynamic precision with existing rules as fallback
        let precision;
        if (numValue >= 1000) precision = 2;
        else if (numValue >= 1) precision = 4;
        else if (numValue >= 0.1) precision = 5;
        else if (numValue >= 0.01) precision = 6;
        else precision = 8;
        
        // Apply your existing precision rules where they exist
        if (CONFIG.defaults.pricePrecision[base]) {
            precision = Math.min(precision, CONFIG.defaults.pricePrecision[base]);
        }
        
        // Clean formatting
        let formatted = numValue.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: precision
        }).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.$/, '');
        
        return `$${formatted}`;
    },
    
    volume: (value) => {
        const num = parseFloat(value);
        if (num >= 1000000000) return `$${(num/1000000000).toFixed(1)}B`;
        if (num >= 1000000) return `$${(num/1000000).toFixed(1)}M`;
        if (num >= 1000) return `$${(num/1000).toFixed(1)}K`;
        return `$${num.toFixed(2)}`;
    },
    change: (value) => {
        return `${parseFloat(value) >= 0 ? '+' : ''}${parseFloat(value).toFixed(2)}%`;
    },
    timer: (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        let timeParts = [];
        if (hours > 0) timeParts.push(hours.toString().padStart(2, '0'));
        if (minutes > 0 || hours > 0) timeParts.push(minutes.toString().padStart(2, '0'));
        timeParts.push(secs.toString().padStart(2, '0'));
        
        return timeParts.join(':');
    },
    
    
dollarChange: (currentPrice, highlightPrice, symbol) => {
    const change = currentPrice - highlightPrice;
    const absChange = Math.abs(change);
    
    // Handle zero-change case
    if (absChange < 0.00000001) { // Near-zero threshold
        return {
            text: `$0.0`,
            colorClass: ''
        };
    }

    // Dynamic precision logic (keep your existing rules)
    const base = symbol.replace('USDT', '');
    let precision;
    if (absChange >= 1000) precision = 2;
    else if (absChange >= 1) precision = 4;
    else if (absChange >= 0.1) precision = 5;
    else if (absChange >= 0.01) precision = 6;
    else precision = 8;
    
    if (CONFIG.defaults.pricePrecision[base]) {
        precision = Math.min(precision, CONFIG.defaults.pricePrecision[base]);
    }
    
    // Format with trailing zero removal
    let formatted = absChange.toFixed(precision)
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.$/, '');
    
    return {
        text: `${change > 0 ? '+' : '-'}$${formatted}`,
        colorClass: change > 0 ? 'up' : 'down'
    };
}
};

// ===== CONNECTION MANAGER =====
    // ===== CONNECTION MANAGER =====
const connectionManager = {
    connect: function() {
        // Clear any existing connection
        if (state.socket) {
            state.socket.onopen = null;
            state.socket.onclose = null;
            state.socket.onerror = null;
            state.socket.close();
        }

        // Use AbortController for better cleanup
        const abortController = new AbortController();
        state.abortController = abortController;

        state.connection.status = 'connecting';
        ui.updateConnectionStatus();
        ui.updateFavicon('connecting');

        state.socket = new WebSocket(state.currentWsUrl);
        state.socket.binaryType = 'arraybuffer';

        state.socket.onopen = () => {
            if (abortController.signal.aborted) return;
            state.connection.status = 'connected';
            state.connection.retryCount = 0;
            state.connection.lastUpdate = Date.now();
            ui.updateConnectionStatus();
            ui.updateFavicon('connected');
            dataManager.loadInitialData();
        };

        state.socket.onmessage = (e) => {
            if (abortController.signal.aborted) return;
            try {
                const data = JSON.parse(e.data);
                state.connection.lastUpdate = Date.now();
                if (!state.isPaused) {
                    dataManager.processMarketData(data);
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        };

        state.socket.onclose = (e) => {
            if (abortController.signal.aborted) return;
            this.handleDisconnection();
        };

        state.socket.onerror = (e) => {
            if (abortController.signal.aborted) return;
            this.handleDisconnection();
        };
    },

    handleDisconnection: function() {
        if (state.isPaused) return;

        state.connection.status = 'disconnected';
        ui.updateConnectionStatus();
        ui.updateFavicon('disconnected');
        this.stopHeartbeat();
        this.scheduleReconnection();
    },

    scheduleReconnection: function() {
        state.connection.retryCount++;
        const delay = Math.min(
            CONFIG.connection.baseDelay * Math.pow(2, state.connection.retryCount),
            CONFIG.connection.maxDelay
        );

        state.connection.status = 'reconnecting';
        ui.updateConnectionStatus();
        ui.updateFavicon('reconnecting');

        setTimeout(() => {
            if (!state.isPaused) this.connect();
        }, delay);
    },

    startHeartbeat: function() {
        this.stopHeartbeat();
    },

    stopHeartbeat: function() {
        if (state.connection.pingInterval) {
            clearInterval(state.connection.pingInterval);
            state.connection.pingInterval = null;
        }
        if (state.pauseTimer) {
            clearInterval(state.pauseTimer);
            state.pauseTimer = null;
        }
        if (state.faviconAnimation) {
            clearInterval(state.faviconAnimation);
            state.faviconAnimation = null;
        }
    },

    cleanup: function() {
        if (state.stalePairInterval) {
            clearInterval(state.stalePairInterval);
            state.stalePairInterval = null;
        }
        this.stopHeartbeat();
    }
};
    // ===== DATA MANAGER =====
    const dataManager = {
loadInitialData: async () => {
    if (state.isLoading) return;
    state.isLoading = true;
    
    try {
    //  ui.showLoading('Loading market data...');
        const response = await fetch(`${CONFIG.api.futures}/ticker/24hr`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const marketData = await response.json();
        state.data = marketData
            .filter(item => item.symbol.endsWith('USDT'))
            .map(item => ({
                ...item,
                hadUpdate: false,
                updateDirection: null
            }));

        // Apply initial sort
        state.data.sort((a, b) => b.quoteVolume - a.quoteVolume);
        state.data = state.data.slice(0, CONFIG.defaults.totalPairs);
        
        
        ui.renderTable();
    } catch (error) {
        console.error('Initial data load failed:', error);
        // Geo issues; VPN Required! 
        ui.showLoading('¯\_(ツ)_/ VPN ?¯');
        setTimeout(dataManager.loadInitialData, 5000);
    } finally {
        state.isLoading = false;
    }
},

processMarketData: (marketData) => {
    if (!Array.isArray(marketData)) return;

    const now = Date.now();
    const STALE_THRESHOLD = 300000; // 5 minutes
    const updates = new Map();

    // Single loop through market data
    marketData.forEach(item => {
        // Validate item
        if (!item.s || !item.c || !item.E) return;
        
        // Check freshness
        const lastUpdateAge = now - item.E;
        if (lastUpdateAge > STALE_THRESHOLD) {
            console.warn(`Stale data for ${item.s}: ${lastUpdateAge}ms old`);
            return;
        }

        // Store valid updates
        updates.set(item.s, {
            price: item.c,
            change: item.P,
            volume: item.q,
            timestamp: item.E // Using the exchange's timestamp
        });
    });

    // Update state
    state.data = state.data.map(item => {
        const update = updates.get(item.symbol);
        if (!update) return item;
        
        return {
            ...item,
            lastPrice: update.price,
            priceChangePercent: update.change,
            quoteVolume: update.volume,
            lastUpdated: update.timestamp,
            hadUpdate: true,
            updateDirection: parseFloat(update.price) > parseFloat(item.lastPrice || 0) ? 'up' : 'down'
        };
    });
            if (searchManager.searchActive) {
            searchManager.updateSearchPrices();
        }
    ui.renderTable();
    }
};
    
    
// ===== DEBOUNCE HELPER =====
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ===== SEARCH MANAGER =====
const searchManager = {
    searchActive: false,
    selectedResultIndex: -1,

    init: function() {
        // Keyboard shortcut to open search
        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && !this.searchActive &&
                document.activeElement !== elements.searchInput &&
                !state.isNotesModalOpen) {
                e.preventDefault();
                this.showSearch();
            }
        });

        // Search input keyboard handling
        elements.searchInput.addEventListener('keydown', (e) => {
            if (!this.searchActive) return;

            const items = Array.from(elements.searchResults.querySelectorAll('.coin-item'));

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (items.length === 0) return;

                    // Clear previous selection
                    if (this.selectedResultIndex >= 0) {
                        items[this.selectedResultIndex].classList.remove('selected');
                    }

                    // Move to next item (or first if none selected)
                    this.selectedResultIndex =
                        this.selectedResultIndex < items.length - 1 ?
                        this.selectedResultIndex + 1 : 0;

                    this.highlightItem(items[this.selectedResultIndex]);
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    if (items.length === 0) return;

                    // Clear previous selection
                    if (this.selectedResultIndex >= 0) {
                        items[this.selectedResultIndex].classList.remove('selected');
                    }

                    // Move to previous item (or last if none selected)
                    this.selectedResultIndex =
                        this.selectedResultIndex > 0 ?
                        this.selectedResultIndex - 1 : items.length - 1;

                    this.highlightItem(items[this.selectedResultIndex]);
                    break;

                case 'Enter':
                    e.preventDefault();
                    if (this.selectedResultIndex >= 0 && items[this.selectedResultIndex]) {
                        items[this.selectedResultIndex].click();
                    }
                    break;

                case 'Escape':
                    e.preventDefault();
                    this.hideSearch();
                    break;
            }
        });

        // Prevent default behavior for Tab key in search results
        elements.searchResults.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
            }
        });
        
                // Prevent page scroll when navigating search results
        elements.searchResults.addEventListener('keydown', (e) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
                e.preventDefault();
            }
        });


        // Click outside to close
        document.addEventListener('click', (e) => {
            if (this.searchActive &&
                !elements.searchContainer.contains(e.target) &&
                e.target !== elements.searchButton) {
                this.hideSearch();
            }
        });

        // Debounced search input
        elements.searchInput.addEventListener('input', debounce((e) => {
            const query = e.target.value.trim().toUpperCase();
            this.selectedResultIndex = -1;

            if (!query) {
                elements.searchResults.innerHTML = '';
                elements.searchResults.style.display = 'none';
                return;
            }

            const filtered = state.data.filter((item) => {
                const symbol = item.symbol.toUpperCase();
                const base = item.symbol.replace('USDT', '').toUpperCase();
                return symbol.includes(query) || base.includes(query);
            }).slice(0, 10);

            this.renderResults(filtered);
        }, 300));
    },

    highlightItem: function(item) {
        // Remove selection from all items first
        const items = elements.searchResults.querySelectorAll('.coin-item');
        items.forEach((i) => i.classList.remove('selected'));

        // Add selection to current item
        item.classList.add('selected');
        item.focus();
        item.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
    },

    showSearch: function() {
        this.searchActive = true;
        this.selectedResultIndex = -1;
        elements.searchContainer.style.display = 'block';
        elements.searchInput.value = '';
        elements.searchResults.innerHTML = '';
        elements.searchContainer.classList.add('active');
        elements.searchInput.focus();
    },

    hideSearch: function() {
        this.searchActive = false;
        this.selectedResultIndex = -1;
        elements.searchContainer.style.display = 'none';
        elements.searchInput.value = '';
        elements.searchResults.innerHTML = '';
        elements.searchContainer.classList.remove('active');
        document.getElementById('searchButton').classList.remove('active');
    },
    renderResults: function(results) {
        elements.searchResults.innerHTML = '';
        this.selectedResultIndex = -1;
        
        if (!results || results.length === 0) {
            elements.searchResults.innerHTML = '<div class="no-results">No matching pairs found</div>';
            elements.searchResults.style.display = 'block';
            return;
        }

        results.forEach((item, index) => {
            const baseSymbol = item.symbol.replace('USDT', '').toLowerCase();
            const priceChange = parseFloat(item.priceChangePercent);
            const priceClass = priceChange >= 0 ? 'up' : 'down';

            const resultItem = document.createElement('div');
            resultItem.className = 'coin-item';
            resultItem.tabIndex = 0;
            resultItem.setAttribute('data-symbol', item.symbol);
            resultItem.innerHTML = `
                <div class="coin-content">
                    <img src="icons/cryptologos/${baseSymbol}.png"
                         onerror="this.onerror=null;this.src='icons/cryptologos/generic.png'"
                         class="search-crypto-icon" width="18" height="18">
                    <span class="pair-name">${item.symbol.replace('USDT', '')}</span>
                </div>
                <div class="price-section">
                    <span class="price ${priceClass}">${formatter.price(item.lastPrice, item.symbol)}</span>
                    <div class="platform-icons">
                        ${this.getPlatformIcons(baseSymbol)}
                    </div>
                </div>
            `;

            resultItem.addEventListener('click', () => {
                this.handleSelect(item.symbol);
            });
            elements.searchResults.appendChild(resultItem);
        });

        elements.searchResults.style.display = 'block';
    },

    getPlatformIcons: function(baseSymbol) {
        return `
            <a href="https://www.bybit.com/future/${baseSymbol}-USDT" target="_blank" class="platform-link">
                <img src="icons/platforms/bybit.png" width="18" height="18" alt="ByBit">
            </a>
            <a href="https://www.binance.com/en/trade/${baseSymbol}_USDT" target="_blank" class="platform-link">
                <img src="icons/platforms/binance.png" width="18" height="18" alt="Binance">
            </a>
            <a href="https://www.gateio.com/future/${baseSymbol}-USDT" target="_blank" class="platform-link">
                <img src="icons/platforms/gateio.png" width="18" height="18" alt="Gateio">
            </a>
            <a href="https://www.tradingview.com/future/${baseSymbol}-USDT" target="_blank" class="platform-link">
                <img src="icons/platforms/WTV.png" width="18" height="18" alt="TradingView">
            </a>
        `;
    },

    handleSelect: function(symbol) {
        const isHighlighted = state.highlightedPairs[symbol] && state.highlightedPairs[symbol].isHighlighted;
        const row = document.querySelector(`tr[data-symbol="${symbol}"]`);

        if (isHighlighted) {
            // Scroll to the highlighted pair
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } else {
            // Not highlighted
            if (!state.pinnedPairs.includes(symbol)) {
                state.pinnedPairs.push(symbol);
                localStorage.setItem('pinnedPairs', JSON.stringify(state.pinnedPairs));
            }

            ui.toggleHighlight(symbol); // This both highlights and copies price
            ui.renderTable(() => {
                const pinnedRow = document.querySelector(`tr[data-symbol="${symbol}"]`);
                if (pinnedRow) {
                    pinnedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        }
    },

    updateSearchPrices: function() {
        if (!this.searchActive) return;

        const results = elements.searchResults.querySelectorAll('.coin-item');
        results.forEach((item) => {
            const symbol = item.getAttribute('data-symbol');
            const priceElement = item.querySelector('.price');

            if (priceElement) {
                const pairData = state.data.find((p) => p.symbol === symbol);
                if (pairData) {
                    const newPrice = formatter.price(pairData.lastPrice, symbol);
                    const priceChange = parseFloat(pairData.priceChangePercent);
                    const priceClass = priceChange >= 0 ? 'up' : 'down';

                    // Only update if price changed to prevent unnecessary DOM updates
                    if (priceElement.textContent !== newPrice) {
                        priceElement.textContent = newPrice;
                        priceElement.className = 'price ' + priceClass;
                        priceElement.classList.add('price-update');
                        setTimeout(() => {
                            priceElement.classList.remove('price-update');
                        }, 500);
                    }
                }
            }
        });
    }
};

        
// ===== UI MANAGER =====
const ui = {
    // ===== LOADING INDICATOR =====
    showLoading: (message) => {
        elements.loadingIndicator.textContent = message;
    },

    // ===== TABLE RENDERING =====
// ===== TABLE RENDERING =====
renderTable: (callback) => {    
    // Sort data
    const sortedData = [...state.data];
    if (state.sortDirection.volume === 'asc') {
        sortedData.sort((a, b) => a.quoteVolume - b.quoteVolume);
    } else if (state.sortDirection.volume === 'desc') {
        sortedData.sort((a, b) => b.quoteVolume - a.quoteVolume);
    } else if (state.sortDirection.change === 'asc') {
        sortedData.sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent));
    } else if (state.sortDirection.change === 'desc') {
        sortedData.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    }

    // Apply pinning
    const pinned = sortedData.filter(item => state.pinnedPairs.includes(item.symbol));
    const unpinned = sortedData.filter(item => !state.pinnedPairs.includes(item.symbol));
    const displayData = [...pinned, ...unpinned].slice(0, state.visibleCount);
    
    // Generate table rows
    elements.tableBody.innerHTML = displayData.map((item, index) => {
        const isPinned = state.pinnedPairs.includes(item.symbol);
        const isHighlighted = state.highlightedPairs[item.symbol];
        const updateClass = item.hadUpdate ? `update-${item.updateDirection}` : '';
        const changeClass = item.priceChangePercent >= 0 ? 'up' : 'down';
        const baseSymbol = item.symbol.replace('USDT', '').toLowerCase();
        
        return `
        <tr data-symbol="${item.symbol}" class="${updateClass} ${isPinned ? 'pinned-row' : ''}">
            <td>
                ${index + 1}
            </td>
            <td>
                <span class="pin-icon" data-symbol="${item.symbol}">
                    <img src="icons/cryptologos/${baseSymbol}.png" alt="${baseSymbol}" class="crypto-icon ${isPinned ? 'pinned-icon' : ''}" 
                         onerror="this.onerror=null; this.src='icons/cryptologos/generic.png'">
                </span>
                ${item.symbol.replace('USDT', '')}
            </td>
            <td class="${isHighlighted ? 'highlighted' : ''}">
                ${formatter.price(item.lastPrice, item.symbol)}
            </td>
            <td class="${changeClass}">
                ${formatter.change(item.priceChangePercent)}
            </td>
            <td>${formatter.volume(item.quoteVolume)}</td>
        </tr>
        `;
    }).join('');

    elements.loadingIndicator.textContent = '';
    ui.attachRowEvents();
    
    // Rest of the function remains the same...
    const volumeHeader = document.getElementById('sortHeader');
    const changeHeader = document.getElementById('changeHeader');

    // Clear all active states
    volumeHeader.classList.remove('sort-active');
    changeHeader.classList.remove('sort-active');

    if (state.sortDirection.volume) {
        volumeHeader.classList.add('sort-active');
        volumeHeader.querySelector('.sort-indicator').textContent = 
            state.sortDirection.volume === 'desc' ? '↖' : '↘';
        changeHeader.querySelector('.sort-indicator').textContent = '';
    } 
    else if (state.sortDirection.change) {
        changeHeader.classList.add('sort-active');
        changeHeader.querySelector('.sort-indicator').textContent = 
            state.sortDirection.change === 'desc' ? '↖' : '↘';
        volumeHeader.querySelector('.sort-indicator').textContent = '';
    }
    else {
        volumeHeader.querySelector('.sort-indicator').textContent = '↖↘';
        changeHeader.querySelector('.sort-indicator').textContent = '';
    }
    
    // Update highlight timers for all highlighted pairs
    Object.keys(state.highlightedPairs).forEach(symbol => {
        if (state.highlightedPairs[symbol]?.isHighlighted) {
            ui.updateHighlightTimer(symbol);
        }
    });        
    
    // Execute callback after render is complete
    if (callback && typeof callback === 'function') {
        setTimeout(callback, 0);
    }
},


// Add to ui object in main.js
// Update the showNotesModal function in main.js
showNotesModal: (symbol) => {
    state.isNotesModalOpen = true;
    const highlightData = state.highlightedPairs[symbol] || {};
    const pairData = state.data.find(item => item.symbol === symbol);

    // Create modal HTML with current price display
const modalHTML = `
<div class="notes-modal-overlay">
    <div class="notes-modal" draggable="true">
        <div class="notes-modal-header">
            <div class="pair-header">
                <img src="icons/cryptologos/${symbol.replace('USDT', '').toLowerCase()}.png"
                     onerror="this.src='icons/cryptologos/generic.png'"
                     class="modal-pair-icon">
                <h3>${symbol.replace('USDT', '')}</h3>
            </div>
            <button class="close-notes-modal">&times;</button>
        </div>
            <div class="notes-modal-body">
                <span class="current-price">Curre: $${pairData?.lastPrice || 'N/A'}</span>

                <div class="pair-info">
                    <span>Price : $${highlightData.highlightPrice}</span>
                    <span>@: ${new Date(highlightData.highlightTime).toLocaleString()}</span>
                </div>
                <textarea class="notes-textarea" placeholder="Ideas & Setups...">${highlightData.notes || ''}</textarea>
                <div class="checkboxes-container">
                    ${(highlightData.checkboxes || [
                        {text: "Entry: ", checked: false},
                        {text: "Exit : ", checked: false},
                        {text: "SL/TP: ", checked: false}
                    ]).map((box, i) => `
                        <label>
                            <input type="checkbox" ${box.checked ? 'checked' : ''}
                                   data-index="${i}"> ${box.text}
                        </label>
                    `).join('')}
                </div>
            </div>
        </div>
    </div>
    `;
    // Add to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Make modal draggable
    const modal = document.querySelector('.notes-modal-overlay');
    const draggableModal = modal.querySelector('.notes-modal');
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    draggableModal.addEventListener('mousedown', dragMouseDown);

    function dragMouseDown(e) {
        if (e.target.classList.contains('notes-textarea') ||
            e.target.tagName === 'INPUT' ||
            e.target.tagName === 'LABEL') {
            return;
        }
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        draggableModal.style.top = (draggableModal.offsetTop - pos2) + "px";
        draggableModal.style.left = (draggableModal.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }

    // Update current price dynamically
// Replace the updateCurrentPrice function with this:
function updateCurrentPrice() {
    const currentPairData = state.data.find(item => item.symbol === symbol);
    if (currentPairData) {
        const currentPriceEl = modal.querySelector('.current-price');
        const highlightPrice = parseFloat(highlightData.highlightPrice || 0);
        const currentPrice = parseFloat(currentPairData.lastPrice || 0);

        currentPriceEl.textContent = `Current: $${currentPairData.lastPrice}`;

        // Remove previous color classes
        currentPriceEl.classList.remove('price-up', 'price-down');

        // Add appropriate color class
        if (currentPrice > highlightPrice) {
            currentPriceEl.classList.add('price-up');
        } else if (currentPrice < highlightPrice) {
            currentPriceEl.classList.add('price-down');
        }
    }
}

    // Add event listeners
    const textarea = modal.querySelector('.notes-textarea');
    const closeBtn = modal.querySelector('.close-notes-modal');

    // Prevent spacebar from pausing when typing in notes
    textarea.addEventListener('keydown', (e) => {
            // Allow these keys to work normally in the textarea
    if (e.key === '?' || e.key === '/') {
        e.stopPropagation(); // Prevent them from triggering shortcuts
        return;
    }
        if (e.key === ' ') {
            e.stopPropagation();
        }
    });

    // Handle text input with asterisk logic
textarea.addEventListener('keydown', function(e) {
    // Only handle Enter key
    if (e.key !== 'Enter') return;

    const cursorPos = this.selectionStart;
    const textBeforeCursor = this.value.substring(0, cursorPos);
    const linesBeforeCursor = textBeforeCursor.split('\n');
    const currentLine = linesBeforeCursor[linesBeforeCursor.length - 1].trim();

    // Check if we're at the end of a line ending with . or ..
    if (currentLine.endsWith('..')) {
        e.preventDefault();
        const textAfterCursor = this.value.substring(cursorPos);
        this.value = textBeforeCursor + '\n* ' + textAfterCursor;
        this.setSelectionRange(cursorPos + 3, cursorPos + 3); // Place cursor after "* "
    }
    else if (currentLine.endsWith('.')) {
        e.preventDefault();
        const textAfterCursor = this.value.substring(cursorPos);
        this.value = textBeforeCursor + '\n- ' + textAfterCursor;
        this.setSelectionRange(cursorPos + 3, cursorPos + 3); // Place cursor after "- "
    }
});

// First line asterisk handling (separate from Enter key)
textarea.addEventListener('input', function(e) {
    if (this.value.length > 0 && !this.value.startsWith('* ')) {
        const cursorPos = this.selectionStart;
        this.value = '* ' + this.value;
        this.setSelectionRange(cursorPos + 2, cursorPos + 2);
    }
});

    // Handle checkbox changes
    modal.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (!state.highlightedPairs[symbol]) return;
            if (!state.highlightedPairs[symbol].checkboxes) {
                state.highlightedPairs[symbol].checkboxes = [
                    {text: "Entry: ", checked: false},
                    {text: "Exit : ", checked: false},
                    {text: "SL/TP: ", checked: false}
                ];
            }
            state.highlightedPairs[symbol].checkboxes[parseInt(checkbox.dataset.index)].checked = checkbox.checked;
            localStorage.setItem(CONFIG.defaults.highlightStorageKey, JSON.stringify(state.highlightedPairs));
        });
    });

    // Close button
    closeBtn.addEventListener('click', () => {
        // Save notes
        if (state.highlightedPairs[symbol]) {
            state.highlightedPairs[symbol].notes = textarea.value;
            localStorage.setItem(CONFIG.defaults.highlightStorageKey, JSON.stringify(state.highlightedPairs));
        }
        modal.remove();
        clearInterval(priceUpdateInterval);
        state.isNotesModalOpen = false;
    });

    // ESC key handler
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            // Save notes
            if (state.highlightedPairs[symbol]) {
                state.highlightedPairs[symbol].notes = textarea.value;
                localStorage.setItem(CONFIG.defaults.highlightStorageKey, JSON.stringify(state.highlightedPairs));
            }
            modal.remove();
            document.removeEventListener('keydown', escHandler);
            clearInterval(priceUpdateInterval);
            state.isNotesModalOpen = false;
        }
    });

    // Only close when clicking outside if there are unsaved changes
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            const confirmClose = confirm('You have unsaved changes. Close without saving?');
            if (confirmClose) {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
                clearInterval(priceUpdateInterval);
            }
        }
    });

    // Prevent closing when clicking inside modal
    draggableModal.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Update current price periodically
    const priceUpdateInterval = setInterval(updateCurrentPrice, 1000);

    // Initial price update
    updateCurrentPrice();

    // Focus textarea
    textarea.focus();
},


attachRowEvents: () => {
    document.querySelectorAll('#data tr').forEach(row => {
        row.addEventListener('click', (e) => {
            const symbol = row.getAttribute('data-symbol');
            const target = e.target;
            
            // Click on pin icon - toggle pin
            if (target.classList.contains('pin-icon')) {
                ui.togglePin(symbol);
            } 
            // Click on price cell (3rd column) - highlight and copy
            else if (target.closest('td:nth-child(3)')) {
                ui.toggleHighlight(symbol, true);
            }
            // Click on pair name cell (2nd column) - toggle pin
            else if (target.closest('td:nth-child(2)')) {
                ui.togglePin(symbol);
            }
            // Click on # column (1st column) - toggle pin
            else if (target.closest('td:nth-child(1)')) {
                ui.togglePin(symbol);
            }
            // Explicitly ignore clicks on 4th and 5th columns
            else if (!target.closest('td:nth-child(4)') && !target.closest('td:nth-child(5)')) {
                // Only highlight if clicking row background (not any specific cell)
                ui.toggleHighlight(symbol);
            }
        });
    });
},

    // ===== PIN/HIGHLIGHT MANAGEMENT =====
    togglePin: (symbol) => {
        const index = state.pinnedPairs.indexOf(symbol);
        if (index === -1) {
            state.pinnedPairs.push(symbol);
        } else {
            state.pinnedPairs.splice(index, 1);
        }
        localStorage.setItem('pinnedPairs', JSON.stringify(state.pinnedPairs));
        ui.renderTable();
    },

toggleHighlight: (symbol, fromPriceClick = false) => {
    const row = document.querySelector(`tr[data-symbol="${symbol}"]`);
    if (!row) return;

    const isHighlighted = !state.highlightedPairs[symbol]?.isHighlighted;
    
    // Initialize or update highlight data
    if (isHighlighted) {
        const currentPrice = parseFloat(state.data.find(item => item.symbol === symbol)?.lastPrice);
        state.highlightedPairs[symbol] = {
            isHighlighted: true,
            highlightTime: Date.now(),
            highlightPrice: currentPrice
        };
        
        // Start timer for this pair
        state.highlightTimers[symbol] = setInterval(() => {
            ui.updateHighlightTimer(symbol);
        }, CONFIG.defaults.highlightTimerInterval);
        
        // Copy price if clicked from price cell
        if (fromPriceClick) {
            const priceCell = row.querySelector('td:nth-child(3)');
            if (priceCell) {
                const priceText = priceCell.textContent.trim();
                navigator.clipboard.writeText(priceText.replace(/[^\d.]/g, ''));
            }
        }
    } else {
        // Clear highlight and timer
        clearInterval(state.highlightTimers[symbol]);
        delete state.highlightTimers[symbol];
        delete state.highlightedPairs[symbol];
    }
    
    // Save to localStorage
    localStorage.setItem(CONFIG.defaults.highlightStorageKey, JSON.stringify(state.highlightedPairs));
    
    // Update the display
    ui.renderTable();
},

    // 24H Volume [$DollarChange | Timer]
// Update the updateHighlightTimer function to include notes icon
updateHighlightTimer: (symbol) => {
    const row = document.querySelector(`tr[data-symbol="${symbol}"]`);
    if (!row) return;

    const highlightData = state.highlightedPairs[symbol];
    if (!highlightData) return;

    const currentItem = state.data.find(item => item.symbol === symbol);
    if (!currentItem) return;

    const currentPrice = parseFloat(currentItem.lastPrice);
    const secondsElapsed = Math.floor((Date.now() - highlightData.highlightTime) / 1000);
    const dollarChange = formatter.dollarChange(currentPrice, highlightData.highlightPrice, symbol);
    const fullTimerText = new Date(secondsElapsed * 1000).toISOString().substr(11, 8);

    // Check if notes exist for this pair
    const hasNotes = highlightData.notes ||
                    (highlightData.checkboxes && highlightData.checkboxes.some(c => c.checked));

    const volumeCell = row.querySelector('td:nth-child(5)');
    if (volumeCell) {
        const originalVolume = formatter.volume(currentItem.quoteVolume);
        volumeCell.innerHTML = `
            <span class="volume-container monospace">
                <span class="volume-value">${originalVolume}</span>
                <span class="highlight-container">
                    [<span class="dollar-change ${dollarChange.colorClass}">${dollarChange.text}</span>
                    <span class="highlight-separator">|</span>
                    <span class="highlight-timer">${fullTimerText}</span> ]
                    <span class="notes-icon ${hasNotes ? 'has-notes' : ''}" data-symbol="${symbol}">📚</span>
                </span>
            </span>
        `;

        // Add click handler for notes icon
        volumeCell.querySelector('.notes-icon').addEventListener('click', (e) => {
            e.stopPropagation();
            ui.showNotesModal(symbol);
        });
    }
},

 // ===== CONNECTION STATUS =====
updateConnectionStatus: () => {
    const statusMap = {
        'connected': ['🟢', 'connected'],
        'disconnected': ['🔴', 'disconnected'],
        'connecting': ['🟡', 'connecting...'],
        'reconnecting': ['🟠', `Retrying (${state.connection.retryCount + 1})`],
        'error': ['⚠️', 'Error'],
        'paused': ['⏸️', 'P']
    };

    const status = state.isPaused ? 'paused' : state.connection.status;
    let [emoji, statusText] = statusMap[status] || ['❓', 'Unknown'];

    // Special handling for paused state with timer
    if (state.isPaused) {
        const pausedSeconds = Math.floor((Date.now() - state.pauseStartTime) / 1000);
        const minutes = Math.floor(pausedSeconds / 60).toString().padStart(2, '0');
        const seconds = (pausedSeconds % 60).toString().padStart(2, '0');
        //Pause Message Orignaally         statusText = `Paused: ${minutes}:${seconds}`;
        statusText = `${minutes}:${seconds}`;
    }

    // Update connection status element
    elements.connectionStatus.innerHTML = `
        <span class="connection-status ${status}">
            ${emoji}
            <span class="tooltip">${statusText}</span>
        </span>
    `;

    // Update title with simplified paused format
        document.title = state.isPaused ?
        `${statusText}` :
        `${statusText}`;
    
    // Update favicon
    ui.updateFavicon(status);
},

updateFavicon: (status) => {
    const statusColors = {
        'connected': '#0ecb81',    // Green
        'disconnected': '#f6465d', // Red
        'connecting': '#f8d347',   // Yellow
        'reconnecting': '#f8d347', // Yellow
        'error': '#ff9900',        // Orange
        'paused': '#aaaaaa'        // Gray
    };

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Set font and text alignment
    ctx.font = '60px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Speed control: Adjust the divisor (200) for faster/slower spin


    // Always spin (Spinning Speed) the Bitcoin symbol
    const spinSpeed = 3; // <<< CHANGE THIS VALUE TO CONTROL SPEED
    const angle = (Date.now() / spinSpeed) % 360;
    ctx.save();
    ctx.translate(32, 32);
    ctx.rotate(angle * Math.PI / 180);
    ctx.fillStyle = statusColors[status] || '#ffffff'; // Default to white if status unknown
    ctx.fillText('₿', 0, 0);
    ctx.restore();

    // Continue animation
    if (!state.faviconAnimation) {
        state.faviconAnimation = setInterval(() => {
            ui.updateFavicon(status);
        }, 50);
    }

    // Update favicon
    let favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
    }
    favicon.href = canvas.toDataURL('image/png');
},
    // ===== CONTROLS SETUP =====
    setupControls: () => {
        // Set default visible pairs
        state.visibleCount = 20;
        // Pair visibility controls
        const showMorePairs = () => {
                if (state.isNotesModalOpen) return;
            const previousCount = state.visibleCount;
            state.visibleCount = Math.min(state.visibleCount + 5, CONFIG.defaults.totalPairs);
            
            if (state.visibleCount !== previousCount) {
                ui.renderTable(() => {
                    const rows = document.querySelectorAll('#data tr');
                    if (rows.length > 0) {
                        rows[rows.length - 1].scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest'
                        });
                    }
                });
            }
        };

        const showLessPairs = () => {
            if (state.isNotesModalOpen) return;
            const previousCount = state.visibleCount;
            state.visibleCount = Math.max(state.visibleCount - 5, 5);
            
            if (state.visibleCount !== previousCount) {
                const lastVisibleRow = document.querySelector(`#data tr:nth-child(${state.visibleCount})`);
                const lastRowPosition = lastVisibleRow ? lastVisibleRow.getBoundingClientRect().top : 0;
                
                ui.renderTable(() => {
                    if (state.visibleCount > 5) {
                        const newLastRow = document.querySelector(`#data tr:nth-child(${state.visibleCount})`);
                        if (newLastRow) {
                            const currentPosition = newLastRow.getBoundingClientRect().top;
                            window.scrollBy({
                                top: currentPosition - lastRowPosition,
                                behavior: 'smooth'
                            });
                        }
                    } else {
                        window.scrollTo({
                            top: 0,
                            behavior: 'smooth'
                        });
                    }
                    // ui.showTempMessage(`Showing ${state.visibleCount} pairs`); // Just message "Showing 5 pairs"
                });
            }
        };

        // Button event listeners
        elements.pauseButton.addEventListener('click', function() {
            state.isPaused = !state.isPaused;
            
            this.textContent = state.isPaused ? 'R' : 'P'; // PAUSE, PAUSED, RESUME, RESUME
            if (state.isPaused) {
                state.pauseStartTime = Date.now();
                state.connection.status = 'paused';
                connectionManager.stopHeartbeat();
                
                state.pauseTimer = setInterval(() => {
                    ui.updateConnectionStatus();
                }, 1000);
            } else {
                if (state.pauseTimer) {
                    clearInterval(state.pauseTimer);
                    state.pauseTimer = null;
                }
                connectionManager.connect();
            }
            ui.updateConnectionStatus();
        });

elements.refreshButton.addEventListener('click', () => {
    if (!state.isPaused && !state.isLoading) {
        dataManager.loadInitialData();
        state.connection.status = 'connected';
        ui.updateConnectionStatus();
    }
});

        elements.showMoreButton.addEventListener('click', showMorePairs);

        // Keyboard shortcuts
// Keyboard shortcuts (keep this as is)
document.addEventListener('keydown', (e) => {
    // Ignore if notes modal is open or typing in inputs
    if (state.isNotesModalOpen ||
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        document.querySelector('.search-container.active')) {
        return;
    }
    
    if (e.key === ' ') {
        e.preventDefault();
        // Toggle pause state
        state.isPaused = !state.isPaused;
        elements.pauseButton.textContent = state.isPaused ? 'R' : 'P';
        
        if (state.isPaused) {
            state.pauseStartTime = Date.now();
            connectionManager.stopHeartbeat();

            state.pauseTimer = setInterval(() => {
                ui.updateConnectionStatus();
            }, 1000);
        } else {
            if (state.pauseTimer) {
                clearInterval(state.pauseTimer);
                state.pauseTimer = null;
            }
            connectionManager.connect();
        }
        ui.updateConnectionStatus();
    }
        // Add checks for ? and / keys
    else if (e.key === '?') {
        e.preventDefault();
        // Your fear/greed info box toggle logic here
    }
    else if (e.key === '/') {
        e.preventDefault();
        if (!state.isNotesModalOpen) {
            searchManager.showSearch();
            elements.searchInput.focus();
        }
    }
    else if (e.key === 'm' || e.key === 'M') showMorePairs();
    else if (e.key === 'l' || e.key === 'L') showLessPairs();
    else if (e.key === 't' || e.key === 'T') toggleTradingView();
});


const upControl = document.querySelector('.mobile-control.up');
const downControl = document.querySelector('.mobile-control.down');

if (upControl && downControl) {
    upControl.addEventListener('click', showLessPairs);
    downControl.addEventListener('click', showMorePairs);
} 
        

    // Volume sort control
elements.sortHeader.addEventListener('click', function(e) {
    // Only trigger sort if clicking on the volume text (not buttons)
    if (e.target.closest('.volume-text') || 
        (!e.target.closest('.header-buttons') && !e.target.closest('button'))) {
        
        // Original sort logic
        if (!state.sortDirection.volume) {
            state.sortDirection = { volume: 'desc', change: null };
        } else {
            state.sortDirection.volume = state.sortDirection.volume === 'desc' ? 'asc' : null;
        }
        ui.renderTable();
    }
});

    // 24H % Change sort control - NEW CODE
    document.getElementById('changeHeader').addEventListener('click', () => {
        // Toggle change sorting (desc → asc → none → desc...)
        if (!state.sortDirection.change) {
            state.sortDirection = { volume: null, change: 'desc' };
        } else {
            state.sortDirection.change = state.sortDirection.change === 'desc' ? 'asc' : null;
        }
        ui.renderTable();
        });
    }
};

//Make sure to clear the timer when the page is unloading.
window.addEventListener('beforeunload', () => {
    // Clear highlight timers
    Object.keys(state.highlightTimers).forEach(symbol => {
        clearInterval(state.highlightTimers[symbol]);
    });
    state.highlightTimers = {};

    // Cleanup connection
    connectionManager.cleanup();
    if (state.abortController) {
        state.abortController.abort();
    }
    if (state.pauseTimer) {
        clearInterval(state.pauseTimer);
    }

    // Clear favicon animation
    if (state.faviconAnimation) {
        clearInterval(state.faviconAnimation);
        state.faviconAnimation = null;
    }

        // Set final static ₿ icon
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '48px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0b90b'; // Gold color for Bitcoin symbol
    ctx.fillText('₿', 32, 32);


    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
        favicon.href = canvas.toDataURL('image/png');
    }
});


// ===== INITIALIZATION =====
// Initialize with device-specific settings
const init = () => {
    document.title = "🟡 • Loading...";
     // Mobile detection should now work since isMobile is defined at the top
    console.log('Initializing for mobile:', isMobile.any());
    // Mobile-specific adjustments
    if (isMobile.any()) {
        // Reduce animation intensity on mobile
        document.documentElement.style.setProperty('--animation-duration', '1000ms');
        
        // Add touch event listeners
        document.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('touchstart', () => {
                btn.classList.add('touch-active');
            });
            btn.addEventListener('touchend', () => {
                btn.classList.remove('touch-active');
            });
        });
    } 
    // Desktop-specific adjustments
    else {
        // Enable hover effects
        document.documentElement.classList.add('desktop');
        // More aggressive animations
        document.documentElement.style.setProperty('--animation-duration', '3000ms');
    }

    // Search button handler
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (elements.searchContainer.style.display === 'block') {
                searchManager.hideSearch();
            } else {
                searchManager.showSearch();
                if (document.activeElement !== elements.searchInput) {
                    elements.searchInput.focus();
                }
            }
        });
    }

    // Connection and stale pair checking setup
    connectionManager.connect();


    // Debug tools
    window.debugTools = {
        checkStale: () => connectionManager.checkStalePairs(),
        listStale: () => {
            const now = Date.now();
            return state.data
                .map(p => ({
                    symbol: p.symbol,
                    staleHours: (now - (p.lastUpdated || 0)) / 3600000,
                    lastUpdated: p.lastUpdated ? new Date(p.lastUpdated).toISOString() : 'Never'
                }))
                .sort((a, b) => b.staleHours - a.staleHours);
        }
    };
    // Initialize remaining components
    ui.setupControls();
    searchManager.init();
    
    // Delay mobile button setup to ensure DOM is ready
    setTimeout(() => {
        setupMobileButtons();
    }, 100);
};
    
// Mobile buttons setup function (outside init)
// Improved mobile button setup with better touch handling
function setupMobileButtons() {
    try {
        if (!isMobile || !isMobile.any()) {
            console.log('Not a mobile device, skipping mobile button setup');
            return;
        }

        console.log('Setting up mobile buttons for:', navigator.userAgent);

        const buttonMap = {
            'mobilePauseButton': 'pauseButton',
            'mobileRefreshButton': 'refreshButton',
            'mobileTVScreen': 'TVScreen',
            'mobileThemeToggle': 'themeToggle',
            'mobileSettingsButton': 'settingsButton'
        };

        // Setup main buttons
        Object.keys(buttonMap).forEach(mobileId => {
            const mobileBtn = document.getElementById(mobileId);
            const desktopBtn = document.getElementById(buttonMap[mobileId]);
            
            if (mobileBtn && desktopBtn) {
                mobileBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    desktopBtn.click();
                });
                console.log(`Connected ${mobileId} to ${buttonMap[mobileId]}`);
            } else {
                console.warn(`Could not find ${mobileId} or ${buttonMap[mobileId]}`);
            }
        });

        // Setup arrow buttons
        const setupArrow = (selector, action) => {
            const arrow = document.querySelector(selector);
            if (arrow) {
                arrow.addEventListener('click', (e) => {
                    e.preventDefault();
                    action();
                });
                console.log(`Setup ${selector} button`);
            } else {
                console.warn(`Could not find ${selector}`);
            }
        };

        // Up arrow - show less pairs
        setupArrow('.mobile-arrow.up', () => {
            state.visibleCount = Math.max(state.visibleCount - 5, 5);
            ui.renderTable();
        });

        // Down arrow - show more pairs (with scroll to last pair)
        setupArrow('.mobile-arrow.down', () => {
            const previousCount = state.visibleCount;
            state.visibleCount = Math.min(state.visibleCount + 5, CONFIG.defaults.totalPairs);
            
            if (state.visibleCount !== previousCount) {
                ui.renderTable(() => {
                    const rows = document.querySelectorAll('#data tr');
                    if (rows.length > 0) {
                        rows[rows.length - 1].scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest'
                        });
                    }
                    ui.showTempMessage(`Showing ${state.visibleCount} pairs`);
                });
            }
        });

    } catch (error) {
        console.error('Error setting up mobile buttons:', error);
    }
}

    // ===== MOBILE MENU TOGGLE =====
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const mobileControlsBox = document.getElementById('mobileControlsBox');

if (mobileMenuToggle && mobileControlsBox) {
    mobileMenuToggle.addEventListener('click', () => {
        const isVisible = mobileControlsBox.style.display === 'flex';
        mobileControlsBox.style.display = isVisible ? 'none' : 'flex';
    });
}
    
    document.addEventListener('click', (e) => {
    if (!mobileMenuToggle.contains(e.target) && !mobileControlsBox.contains(e.target)) {
        mobileControlsBox.style.display = 'none';
    }
});


    // Cleanup
    window.addEventListener('beforeunload', () => {

        // Clear highlight timers
        Object.keys(state.highlightTimers).forEach(symbol => {
            clearInterval(state.highlightTimers[symbol]);
        });
        state.highlightTimers = {};

        // Cleanup connection
        connectionManager.cleanup();
        if (state.abortController) {
            state.abortController.abort();
        }
        if (state.pauseTimer) {
            clearInterval(state.pauseTimer);
        }
    });

    init();
});
