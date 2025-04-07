// Theme Toggle Functionality
function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    const icon = themeToggle.querySelector('i');
    
    // Function to apply theme
    function applyTheme(isLight) {
        if (isLight) {
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
        } else {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
        }
        updateIcon(isLight);
    }
    
    // Function to update icon
    function updateIcon(isLight) {
        icon.classList.toggle('fa-sun', isLight);
        icon.classList.toggle('fa-moon', !isLight);
    }
    
    // Function to get system preference
    function getSystemPreference() {
        return window.matchMedia('(prefers-color-scheme: light)').matches;
    }
    
    // Initialize theme
    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        const systemPrefersLight = getSystemPreference();
        
        if (savedTheme) {
            // Use saved preference
            applyTheme(savedTheme === 'light');
        } else {
            // Use system preference
            applyTheme(systemPrefersLight);
        }
    }
    
    // Set up system preference listener
    function setupSystemPreferenceListener() {
        const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');
        colorSchemeQuery.addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                applyTheme(e.matches);
            }
        });
    }
    
    // Set up toggle button
    function setupToggleButton() {
        themeToggle.addEventListener('click', () => {
            const isLight = !document.body.classList.contains('light-theme');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            applyTheme(isLight);
        });
    }
    
    // Initialize everything
    initTheme();
    setupSystemPreferenceListener();
    setupToggleButton();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initThemeToggle);