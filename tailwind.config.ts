
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#f97316', // orange
          dark: '#ea580c',
        },
        graybg: '#f7f7f9'
      }
    },
  },
  plugins: [],
}
export default config
