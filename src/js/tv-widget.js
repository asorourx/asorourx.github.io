// tradingview-highlight-widget.js
document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const tvButton = document.getElementById('TVScreen');
    const tvContainer = document.getElementById('tradingview-widget-container');
    const tvWidget = document.querySelector('.tradingview-widget-container__widget');

    // Configuration
    const MAX_SYMBOLS = 25;
    const DEFAULT_SYMBOLS = [
        { "proName": "FOREXCOM:SPXUSD", "title": "S&P 500" },
        { "proName": "NASDAQ:TSLA", "title": "Tesla" },
        { "proName": "FX_IDC:EURUSD", "title": "EUR/USD" },
        { "proName": "FX:USDJPY", "title": "USD/JPY" },
        { "proName": "FX:GBPUSD", "title": "GBP/USD" },
        { "proName": "OANDA:XAUUSD", "title": "Gold" },
    ];

    // State
    let tvScriptLoaded = false;
    let highlightedSymbols = [];

    // Initialize widget
    function initWidget() {
        const isVisible = localStorage.getItem('tvWidgetVisible') === 'true';
        tvContainer.style.display = isVisible ? 'block' : 'none';
        if (isVisible) {
            loadWidget();
        }

        // Watch for storage events to detect highlights from main.js
        window.addEventListener('storage', handleStorageEvent);

        // Also check periodically in case storage event doesn't fire
        setInterval(checkForHighlights, 1000);
    }

    // Load or reload the widget
    function loadWidget() {
        if (tvWidget) {
            tvWidget.innerHTML = '';
            const script = document.createElement('script');
            script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
            script.async = true;
            script.innerHTML = JSON.stringify(getWidgetConfig());
            tvWidget.appendChild(script);
            tvScriptLoaded = true;
        }
    }

    // Get current widget configuration
    function getWidgetConfig() {
        // Convert highlighted symbols to TradingView format
        const highlightPairs = highlightedSymbols.map(function(symbol) {
            return {
                "proName": "BINANCE:" + symbol.replace('USDT', '') + "USDT.P", // Futures format
                "title": symbol.replace('USDT', '')
            };
        });

        // Combine with default symbols (highlights first)
        const allSymbols = highlightPairs.concat(DEFAULT_SYMBOLS).slice(0, MAX_SYMBOLS);

        return {
            "symbols": allSymbols,
            "showSymbolLogo": true,
            "isTransparent": true,
            "displayMode": "compact",
            "colorTheme": "dark",
            "locale": "en",
            "width": "100%",
            "height": "100%"
        };
    }

    // Toggle widget visibility
    function toggleWidget() {
        const isVisible = tvContainer.style.display === 'none';
        tvContainer.style.display = isVisible ? 'block' : 'none';
        localStorage.setItem('tvWidgetVisible', isVisible);
        
        if (isVisible) {
            if (!tvScriptLoaded) {
                loadWidget();
            } else {
                updateWidget();
            }
        }
    }

    // Update widget with current symbols
    function updateWidget() {
        if (tvScriptLoaded) {
            loadWidget(); // Just reload with current config
        }
    }

    // Handle storage events to detect highlights
    function handleStorageEvent(event) {
        if (event.key === 'highlightedPairsData') {
            updateHighlightedSymbols();
        }
    }

    // Check localStorage for highlighted pairs
    function checkForHighlights() {
        updateHighlightedSymbols();
    }

    // Update highlighted symbols from localStorage
    function updateHighlightedSymbols() {
        try {
            const highlights = JSON.parse(localStorage.getItem('highlightedPairsData')) || {};
            const newSymbols = Object.keys(highlights).filter(function(sym) {
                return highlights[sym] && highlights[sym].isHighlighted;
            });

            if (JSON.stringify(newSymbols) !== JSON.stringify(highlightedSymbols)) {
                highlightedSymbols = newSymbols;
                if (tvContainer.style.display === 'block') {
                    updateWidget();
                }
            }
        } catch (e) {
            console.error('Error reading highlights:', e);
        }
    }

    // Button click handler
    tvButton.addEventListener('click', function(e) {
        e.preventDefault();
        toggleWidget();
    });

    // Keyboard shortcut
    document.addEventListener('keydown', function(e) {
        if (e.key.toLowerCase() === 't' && !e.target.matches('input, textarea, [contenteditable]')) {
            e.preventDefault();
            toggleWidget();
            tvButton.classList.add('active');
            setTimeout(function() {
                tvButton.classList.remove('active');
            }, 200);
        }
    });

    // Initialize
    initWidget();
});
