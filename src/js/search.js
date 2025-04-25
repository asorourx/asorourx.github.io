// search.js - Complete Implementation with Live Price Updates
class SearchManager {
  constructor(config) {
    this.searchSymbols = [];
    this.searchActive = false;
    this.selectedResultIndex = -1;
    this.lastRenderTime = 0;
    this.renderThrottle = 200; // ms between renders
    this.config = {
      apiEndpoints: {
        spotExchangeInfo: 'https://api.binance.com/api/v3/exchangeInfo',
        futuresExchangeInfo: 'https://fapi.binance.com/fapi/v1/exchangeInfo'
      },
      ...config
    };

    this.init();
  }

  async init() {
    await this.initializeSearch();
    this.setupEventListeners();
  }

  async initializeSearch() {
    try {
      const [spotResponse, futuresResponse] = await Promise.all([
        fetch(this.config.apiEndpoints.spotExchangeInfo),
        fetch(this.config.apiEndpoints.futuresExchangeInfo)
      ]);

      const [spotData, futuresData] = await Promise.all([
        spotResponse.json(),
        futuresResponse.json()
      ]);

      const spotSymbols = spotData.symbols
        .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map(s => ({
          symbol: s.baseAsset,
          type: 'spot',
          pairKey: `${s.baseAsset}USDT`
        }));

      const futuresSymbols = futuresData.symbols
        .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map(s => ({
          symbol: s.baseAsset,
          type: 'futures',
          pairKey: `${s.baseAsset}USDT`
        }));

      // Merge and deduplicate
      this.searchSymbols = [...spotSymbols, ...futuresSymbols].reduce((acc, curr) => {
        if (!acc.some(item => item.symbol === curr.symbol)) {
          acc.push(curr);
        }
        return acc;
      }, []);

    } catch (error) {
      console.error('Search initialization failed:', error);
      this.searchSymbols = [];
    }
  }

  setupEventListeners() {
    // Throttled input handler
    this.config.searchInput.addEventListener('input', (e) => {
      const now = Date.now();
      if (now - this.lastRenderTime > this.renderThrottle) {
        this.handleSearchInput(e);
        this.lastRenderTime = now;
      }
    });
    
    // Keyboard controls
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !this.searchActive && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        this.showSearch();
      }

      if (this.searchActive) {
        switch (e.key) {
          case 'Escape':
            this.hideSearch();
            break;
          case 'ArrowDown':
            this.selectSearchResult(this.selectedResultIndex + 1);
            break;
          case 'ArrowUp':
            this.selectSearchResult(this.selectedResultIndex - 1);
            break;
          case 'Enter':
            this.executeSearchSelection();
            break;
        }
      }
    });
  }

  showSearch() {
    this.searchActive = true;
    this.config.searchContainer.style.display = 'block';
    this.config.searchInput.focus();
    this.config.searchInput.value = '';
    this.config.searchResults.innerHTML = '';
    this.updateSearchPrices(); // Initial price load
  }

  hideSearch() {
    this.searchActive = false;
    this.config.searchContainer.style.display = 'none';
    this.config.searchInput.value = '';
    this.config.searchResults.innerHTML = '';
    this.selectedResultIndex = -1;
  }

  handleSearchInput(e) {
    const query = e.target.value.trim().toUpperCase();
    if (!query) {
      this.config.searchResults.innerHTML = '';
      this.selectedResultIndex = -1;
      return;
    }

    const filtered = this.searchSymbols.filter(item => 
      item.symbol.includes(query)
    ).slice(0, 10);

    this.renderSearchResults(filtered);
  }

  renderSearchResults(results) {
    this.config.searchResults.innerHTML = results.map((item, index) => {
      const currentPrice = this.config.getCurrentPrice
        ? this.config.getCurrentPrice(item.pairKey)
        : null;

      return `
      <div class="coin-item ${index === this.selectedResultIndex ? 'selected' : ''}" 
           data-symbol="${item.symbol}" 
           data-type="${item.type}"
           data-pair="${item.pairKey}">
        <div class="coin-content">
          <span class="pair-name">${item.symbol}/USDT</span>
          <span class="current-price">${currentPrice ? `$${currentPrice}` : 'Loading...'}</span>
          <div class="platform-icons-container">
            ${this.config.getPlatformIcons(item.symbol)}
          </div>
        </div>
        <span class="market-type ${item.type === 'spot' ? 'spot-type' : 'futures-type'}">
          ${item.type === 'spot' ? 'SPOT' : 'FUTURES'}
        </span>
      </div>
      `;
    }).join('');

    this.addSearchResultListeners();
  }

  updateSearchPrices() {
    if (!this.searchActive || !this.config.searchResults) return;

    const now = Date.now();
    if (now - this.lastRenderTime < this.renderThrottle) return;

    const items = this.config.searchResults.querySelectorAll('.coin-item');
    items.forEach(item => {
      const pairKey = item.getAttribute('data-pair');
      const priceElement = item.querySelector('.current-price');

      if (priceElement && this.config.getCurrentPrice) {
        const currentPrice = this.config.getCurrentPrice(pairKey);
        if (currentPrice) {
          const newPrice = `$${currentPrice}`;
          if (priceElement.textContent !== newPrice) {
            priceElement.textContent = newPrice;
            priceElement.classList.add('price-update');
            setTimeout(() => {
              priceElement.classList.remove('price-update');
            }, 500);
          }
        }
      }
    });

    this.lastRenderTime = now;
  }

  addSearchResultListeners() {
    // Platform icon clicks
    document.querySelectorAll('.platform-icons-container img').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const symbol = img.closest('.coin-item').getAttribute('data-symbol');
        const platform = img.getAttribute('alt').toLowerCase();
        const url = this.config.platformUrls[platform](symbol);
        window.open(url, '_blank');
      });
    });

    // Result item clicks
    document.querySelectorAll('.coin-item').forEach(item => {
      item.addEventListener('click', () => {
        const symbol = item.getAttribute('data-symbol');
        const type = item.getAttribute('data-type');
        this.config.onPairSelect(symbol, type);
        this.hideSearch();
      });
    });
  }

  selectSearchResult(index) {
    const results = document.querySelectorAll('.coin-item');
    if (results.length === 0) return;

    if (this.selectedResultIndex >= 0 && this.selectedResultIndex < results.length) {
      results[this.selectedResultIndex].classList.remove('selected');
    }

    // Circular navigation
    if (index >= results.length) index = 0;
    if (index < 0) index = results.length - 1;

    this.selectedResultIndex = index;
    const selected = results[this.selectedResultIndex];
    selected.classList.add('selected');
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  executeSearchSelection() {
    const results = document.querySelectorAll('.coin-item');
    if (this.selectedResultIndex >= 0 && this.selectedResultIndex < results.length) {
      const selected = results[this.selectedResultIndex];
      selected.click(); // Trigger the click handler
    }
  }
}

// Export for both ES modules and legacy
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SearchManager;
} else {
  window.SearchManager = SearchManager;
}
