import { heroui } from '@heroui/react'

const iconBlue = {
  50: '#eff8ff',
  100: '#d9eeff',
  200: '#bddfff',
  300: '#99ccff',
  400: '#7abaff',
  500: '#69afff',
  600: '#4b98f4',
  700: '#377fdd',
  800: '#2f68b3',
  900: '#2c598d',
  foreground: '#ffffff',
  DEFAULT: '#69afff'
}

export default heroui({
  themes: {
    light: {
      colors: {
        background: '#f7fbff',
        foreground: '#1b2435',
        divider: '#d9e8f7',
        focus: iconBlue[500],
        content1: '#ffffff',
        content2: '#eef6ff',
        content3: '#ddeeff',
        content4: '#cae4ff',
        default: {
          50: '#fafcff',
          100: '#f2f7fc',
          200: '#e6eef7',
          300: '#d5dfec',
          400: '#afbccd',
          500: '#7f8b9d',
          600: '#616b7c',
          700: '#4c5566',
          800: '#31384a',
          900: '#1e2535',
          foreground: '#1b2435',
          DEFAULT: '#eef4fb'
        },
        primary: iconBlue,
        secondary: {
          50: '#f3f7ff',
          100: '#e6eeff',
          200: '#d4e0ff',
          300: '#b9cbff',
          400: '#95adff',
          500: '#738fff',
          600: '#5d72f5',
          700: '#4d5bdf',
          800: '#414cb4',
          900: '#39438d',
          foreground: '#ffffff',
          DEFAULT: '#738fff'
        },
        success: '#4caf78',
        warning: '#f2ad4e',
        danger: '#eb6d73'
      }
    },
    dark: {
      colors: {
        background: '#111826',
        foreground: '#eef4ff',
        divider: '#22324a',
        focus: iconBlue[400],
        content1: '#162033',
        content2: '#1b2840',
        content3: '#22314d',
        content4: '#2a3b5c',
        default: {
          50: '#172133',
          100: '#1c2740',
          200: '#24324f',
          300: '#30415f',
          400: '#50637f',
          500: '#75849c',
          600: '#95a2b7',
          700: '#b7c3d5',
          800: '#dae4f3',
          900: '#eff4ff',
          foreground: '#eef4ff',
          DEFAULT: '#1c2740'
        },
        primary: {
          ...iconBlue,
          50: '#17335a',
          100: '#1d4275',
          200: '#25579a',
          300: '#2f72c9',
          400: '#4a92f2',
          500: '#69afff',
          600: '#84beff',
          700: '#a3d0ff',
          800: '#c7e3ff',
          900: '#e7f4ff',
          foreground: '#0e1a2b',
          DEFAULT: '#69afff'
        },
        secondary: {
          50: '#1f2247',
          100: '#2a2f62',
          200: '#373f84',
          300: '#4853ad',
          400: '#6171d8',
          500: '#7d91ff',
          600: '#99a7ff',
          700: '#b6c0ff',
          800: '#d6deff',
          900: '#eef1ff',
          foreground: '#10162a',
          DEFAULT: '#7d91ff'
        },
        success: '#58c48b',
        warning: '#f0ba61',
        danger: '#ef7d83'
      }
    }
  }
})
