/**
 * Shared header!
 * This script injects the unified header into elements with id="header-placeholder"
 */

document.addEventListener('DOMContentLoaded', () => {
    const placeholder = document.getElementById('header-placeholder');
    if (!placeholder) return;

    // index.html draws its own, more fun header, so this is only the restrained look every tool gets.
    placeholder.innerHTML = `
    <header class="ucd-header">
        <div class="header-content">
            <div class="header-logo-container">
                <div class="uc-badge"></div>
                <h1 class="header-title">Blue Cluster Tools</h1>
            </div>
            <a href="index.html" class="header-back-btn">Back to Index ➔</a>
        </div>
    </header>
    `;
});
