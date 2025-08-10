/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Colors from your design tokens
      colors: {
        primary: {
          DEFAULT: '#2563eb',
          light: '#3b82f6',
          dark: '#1d4ed8',
        },
        secondary: {
          DEFAULT: '#14b8a6',
          light: '#20d3c2',
          dark: '#0f766e',
        },
        accent: {
          DEFAULT: '#f97316',
          light: '#fb923c',
          dark: '#ea580c',
        },
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
      },
      
      // Typography
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"SF Mono"', 'Monaco', 'Inconsolata', '"Roboto Mono"', 'monospace'],
      },
      
      // Spacing (8px grid system)
      spacing: {
        '1': '0.25rem',
        '2': '0.5rem',
        '3': '0.75rem',
        '4': '1rem',
        '5': '1.25rem',
        '6': '1.5rem',
        '8': '2rem',
        '10': '2.5rem',
        '12': '3rem',
        '16': '4rem',
        '20': '5rem',
        '24': '6rem',
      },
      
      // Container
      maxWidth: {
        'container': '1200px',
      },
      
      // Box shadows
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      },
      
      // Border radius
      borderRadius: {
        'sm': '0.25rem',
        'md': '0.5rem',
        'lg': '0.75rem',
        'xl': '1rem',
      },
      
      // Transitions
      transitionDuration: {
        'fast': '150ms',
        'normal': '300ms',
        'slow': '500ms',
      },
      
      // Typography scale
      fontSize: {
        'xs': '0.75rem',
        'sm': '0.875rem',
        'base': '1rem',
        'lg': '1.125rem',
        'xl': '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
        '5xl': '3rem',
      },
      
      // Line heights
      lineHeight: {
        'tight': '1.1',
        'snug': '1.2',
        'normal': '1.25',
        'relaxed': '1.3',
        'loose': '1.6',
        'extra-loose': '1.7',
      },
      
      // Additional utilities for your components
      minHeight: {
        'btn': '44px',
        'btn-large': '52px',
      },
      
      // Grid template columns for your layouts
      gridTemplateColumns: {
        'auto-fit-sm': 'repeat(auto-fit, minmax(250px, 1fr))',
        'auto-fit-md': 'repeat(auto-fit, minmax(280px, 1fr))',
        'auto-fit-lg': 'repeat(auto-fit, minmax(320px, 1fr))',
        'auto-fit-xl': 'repeat(auto-fit, minmax(350px, 1fr))',
        'sidebar': '300px 1fr',
        'content-sidebar': '2fr 1fr',
      },
    },
  },
  plugins: [
    // Add custom component classes
    function({ addComponents, theme }) {
      addComponents({
        // Container component
        '.container-custom': {
          maxWidth: theme('maxWidth.container'),
          margin: '0 auto',
          padding: `0 ${theme('spacing.6')}`,
        },
        
        // Button base
        '.btn': {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${theme('spacing.3')} ${theme('spacing.6')}`,
          fontSize: theme('fontSize.base'),
          fontWeight: '500',
          borderRadius: theme('borderRadius.md'),
          cursor: 'pointer',
          transition: `all ${theme('transitionDuration.fast')} ease-in-out`,
          border: 'none',
          textDecoration: 'none',
          minHeight: theme('minHeight.btn'),
          whiteSpace: 'nowrap',
        },
        
        // Button variants
        '.btn-primary': {
          backgroundColor: theme('colors.primary.DEFAULT'),
          color: theme('colors.white'),
          boxShadow: theme('boxShadow.sm'),
          '&:hover': {
            backgroundColor: theme('colors.primary.dark'),
            color: theme('colors.white'),
            boxShadow: theme('boxShadow.md'),
            transform: 'translateY(-1px)',
          },
        },
        
        '.btn-outline-primary': {
          background: 'transparent',
          border: `2px solid ${theme('colors.primary.DEFAULT')}`,
          color: theme('colors.primary.DEFAULT'),
          '&:hover': {
            backgroundColor: theme('colors.primary.DEFAULT'),
            color: theme('colors.white'),
          },
        },
        
        '.btn-secondary': {
          backgroundColor: theme('colors.gray.100'),
          color: theme('colors.gray.700'),
          border: `1px solid ${theme('colors.gray.300')}`,
          '&:hover': {
            backgroundColor: theme('colors.gray.200'),
            color: theme('colors.gray.800'),
            borderColor: theme('colors.gray.400'),
          },
        },
        
        '.btn-large': {
          padding: `${theme('spacing.4')} ${theme('spacing.8')}`,
          fontSize: theme('fontSize.lg'),
          minHeight: theme('minHeight.btn-large'),
        },
        
        // Card components
        '.card': {
          backgroundColor: theme('colors.white'),
          borderRadius: theme('borderRadius.lg'),
          padding: theme('spacing.6'),
          boxShadow: theme('boxShadow.sm'),
          transition: `all ${theme('transitionDuration.fast')} ease-in-out`,
          '&:hover': {
            boxShadow: theme('boxShadow.lg'),
            transform: 'translateY(-4px)',
          },
        },
        
        '.card-feature': {
          backgroundColor: theme('colors.white'),
          borderRadius: theme('borderRadius.lg'),
          padding: theme('spacing.8'),
          boxShadow: theme('boxShadow.sm'),
          transition: `all ${theme('transitionDuration.normal')} ease-in-out`,
          textAlign: 'center',
          '&:hover': {
            boxShadow: theme('boxShadow.lg'),
            transform: 'translateY(-4px)',
          },
        },
        
        '.card-tool': {
          backgroundColor: theme('colors.white'),
          borderRadius: theme('borderRadius.lg'),
          padding: theme('spacing.8'),
          boxShadow: theme('boxShadow.md'),
          transition: `all ${theme('transitionDuration.normal')} ease-in-out`,
          border: `1px solid ${theme('colors.gray.200')}`,
          '&:hover': {
            boxShadow: theme('boxShadow.xl'),
            transform: 'translateY(-4px)',
          },
        },
        
        // Form components
        '.form-input': {
          width: '100%',
          padding: theme('spacing.3'),
          border: `2px solid ${theme('colors.gray.300')}`,
          borderRadius: theme('borderRadius.md'),
          fontSize: theme('fontSize.base'),
          transition: `border-color ${theme('transitionDuration.fast')} ease-in-out`,
          '&:focus': {
            outline: 'none',
            borderColor: theme('colors.primary.DEFAULT'),
            boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.1)',
          },
        },
        
        // Badge components
        '.badge': {
          display: 'inline-block',
          padding: `${theme('spacing.1')} ${theme('spacing.3')}`,
          borderRadius: theme('borderRadius.sm'),
          fontSize: theme('fontSize.sm'),
          fontWeight: '500',
          textDecoration: 'none',
          transition: `all ${theme('transitionDuration.fast')} ease-in-out`,
        },
        
        '.badge-primary': {
          backgroundColor: theme('colors.primary.DEFAULT'),
          color: theme('colors.white'),
          '&:hover': {
            backgroundColor: theme('colors.primary.dark'),
            color: theme('colors.white'),
          },
        },
        
        '.badge-gray': {
          backgroundColor: theme('colors.gray.100'),
          color: theme('colors.gray.700'),
          '&:hover': {
            backgroundColor: theme('colors.primary.DEFAULT'),
            color: theme('colors.white'),
          },
        },
        
        // Page layouts
        '.page-header': {
          padding: `${theme('spacing.16')} 0 ${theme('spacing.12')}`,
          background: `linear-gradient(135deg, ${theme('colors.gray.50')} 0%, ${theme('colors.white')} 100%)`,
          textAlign: 'center',
        },
        
        '.section-title': {
          textAlign: 'center',
          marginBottom: theme('spacing.12'),
          fontSize: theme('fontSize.4xl'),
          color: theme('colors.gray.900'),
        },
        
        // Icon utilities
        '.icon-feature': {
          fontSize: '3rem',
          marginBottom: theme('spacing.4'),
          display: 'block',
          color: theme('colors.primary.DEFAULT'),
        },
        
        '.icon-lg': {
          fontSize: '3rem',
          color: theme('colors.primary.DEFAULT'),
        },
        
        '.icon-md': {
          fontSize: '2.5rem',
          color: theme('colors.primary.DEFAULT'),
        },
        
        '.icon-sm': {
          fontSize: '1.5rem',
          color: theme('colors.primary.DEFAULT'),
        },
      })
    }
  ],
}
