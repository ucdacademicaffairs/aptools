/**
 * Shared Header Component for Blue Cluster Tools
 * This script injects the unified header into elements with id="header-placeholder"
 */

document.addEventListener('DOMContentLoaded', () => {
    const placeholder = document.getElementById('header-placeholder');
    if (!placeholder) return;

    const isIndex = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
    
    if (isIndex) {
        // Index page structure (Glassmorphism + Animation + Container)
        placeholder.innerHTML = `
        <header class="page-header animate-on-load">
            <div class="container">
                <div class="header-content">
                    <div style="display: flex; align-items: center;">
                        <div class="uc-badge" title="Click me 5 times!"></div>
                        <h1 class="header-title" style="color: white;">Blue Cluster Heavy Industries</h1>
                    </div>
                </div>
            </div>
        </header>
        `;
    } else {
        // Tool page structure (Solid Navy + Back Button)
        placeholder.innerHTML = `
        <header class="ucd-header">
            <div class="header-content">
                <div class="header-logo-container">
                    <div class="uc-badge"></div>
                    <h1 class="header-title">Blue Cluster Heavy Industries</h1>
                </div>
                <a href="index.html" class="header-back-btn">Back to Tools ➔</a>
            </div>
        </header>
        `;
    }
});
