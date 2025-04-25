// theme.js - Complete Theme Toggle with PNG Icon Support
document.addEventListener('DOMContentLoaded', function() {
    const themeToggle = document.getElementById('themeToggle');
    
    // Check and apply saved theme preference
    function applyTheme(isLight) {
        if (isLight) {
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
            localStorage.setItem('theme', 'light');
        } else {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
            localStorage.setItem('theme', 'dark');
        }
    }
    
    // Get system color scheme preference
    function getSystemPreference() {
        return window.matchMedia('(prefers-color-scheme: light)').matches;
    }
    
    // Initialize theme on page load
    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        
        if (savedTheme) {
            // Use saved preference if exists
            applyTheme(savedTheme === 'light');
        } else {
            // Fallback to system preference
            applyTheme(getSystemPreference());
        }
    }
    
    // Listen for system preference changes
    function setupSystemPreferenceListener() {
        const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');

        colorSchemeQuery.addEventListener('change', (e) => {
            // Only apply system preference if no user preference is set
            if (!localStorage.getItem('theme')) {
                applyTheme(e.matches);
            }
        });
    }
    
    // Set up theme toggle button
    function setupToggleButton() {
        themeToggle.addEventListener('click', function() {
            const isLight = !document.body.classList.contains('light-theme');
            applyTheme(isLight);
        });
    }
    
    // Initialize everything
    function initThemeToggle() {
        initTheme();
        setupSystemPreferenceListener();
        setupToggleButton();
    }

    initThemeToggle();
});
