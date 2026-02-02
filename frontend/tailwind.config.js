/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--bg)",
                panel: "var(--panel)",
                primary: "var(--neon)", // #d7ceb9 (Cream)
                "primary-soft": "var(--neon-soft)",
                muted: "var(--text-muted)",
                accent: "var(--text-accent)", // bluish typically or just use primary
            },
        },
    },
    plugins: [],
};
