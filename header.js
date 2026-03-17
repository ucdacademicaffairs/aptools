/**
 * Shared Header Component for Blue Cluster Tools
 * This script injects the unified header into elements with id="header-placeholder"
 */

document.addEventListener('DOMContentLoaded', () => {
    const placeholder = document.getElementById('header-placeholder');
    if (!placeholder) return;

    const isIndex = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
    
    const backButton = isIndex ? '' : '<a href="index.html" class="header-back-btn">Back to Tools ➔</a>';

    const headerHTML = `
    <header class="ucd-header">
        <div class="header-content">
            <div class="header-logo-container">
                <div class="uc-badge"></div>
                <h1 class="header-title">Blue Cluster Heavy Industries</h1>
            </div>
            ${backButton}
        </div>
    </header>
    `;

    placeholder.innerHTML = headerHTML;
});
