import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  createTheme,
  Drawer,
  mergeThemeOverrides,
  Menu,
  Modal,
  NavLink,
  NumberInput,
  Paper,
  PasswordInput,
  Progress,
  rem,
  SegmentedControl,
  Select,
  Switch,
  Table,
  Tabs,
  TagsInput,
  Textarea,
  TextInput,
  Tooltip,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';
import { DatePickerInput, DateTimePicker, MonthPickerInput } from '@mantine/dates';

/*
 * MyGarage design tokens — a native iPhone app of iOS 26/27 (Liquid Glass), built with the web, made
 * vivid (v0.10): colour carries meaning, words are few. The iOS system palette: grouped grey canvas, white
 * inset groups with 24 px corners and no borders, hairline separators, a soft glow under the large title.
 * One accent — the key "cobalt", iOS blue by default, chosen on the device (ui/accent.ts); every step of
 * a job has its own iOS colour (PHASE_META) — on the board, its pill and the glow of its screen. Controls
 * are capsules; filled buttons glow in their colour; the bars float over the content as glass. Type is
 * the phone's own system face (SF Pro on iPhone, Roboto on Android, Segoe UI on Windows): a heavy 34 large
 * title, bold 17 headings, 17 body, 15 secondary, 13 footnote; big figures rounded.
 */

// Tint: iOS system blue (#007AFF light, #0A84FF dark).
const cobalt: MantineColorsTuple = [
  '#e8f2ff',
  '#d0e5ff',
  '#a3cbff',
  '#70adff',
  '#3d91ff',
  '#0a84ff',
  '#007aff',
  '#006be0',
  '#005bbf',
  '#004a9c',
];

// iOS neutral greys (systemGray6 … label).
const gray: MantineColorsTuple = [
  '#f7f7f9',
  '#efeff3',
  '#e5e5ea',
  '#d1d1d6',
  '#aeaeb2',
  '#8e8e93',
  '#6d6d72',
  '#48484a',
  '#2c2c2e',
  '#1c1c1e',
];

// Dark mode surfaces: black canvas, #1C1C1E groups (iOS dark).
const dark: MantineColorsTuple = [
  '#f2f2f7',
  '#c7c7cc',
  '#98989f',
  '#6e6e73',
  '#48484a',
  '#3a3a3c',
  '#2c2c2e',
  '#1c1c1e',
  '#121214',
  '#000000',
];

// iOS semantic colours.
const green: MantineColorsTuple = ['#e9f9ee', '#d2f3dc', '#a6e7b9', '#77da95', '#4fce77', '#3ccb6a', '#34c759', '#28a745', '#1f8a39', '#166c2c'];
const red: MantineColorsTuple = ['#ffeceb', '#ffd9d7', '#ffb1ad', '#ff8780', '#ff645b', '#ff4f45', '#ff3b30', '#e0281e', '#bd1d14', '#9a130b'];
const orange: MantineColorsTuple = ['#fff4e5', '#ffe9cc', '#ffd399', '#ffbd66', '#ffaa3d', '#ff9f24', '#ff9500', '#e08200', '#bd6d00', '#9a5800'];
// The rest of the iOS system palette (shade 6 — the light appearance, 5 — the dark one): the steps of a job
// (PHASE_META), icon tiles and today's cards each take one, so a state reads by its colour.
const blue: MantineColorsTuple = ['#e6f2ff', '#cce4ff', '#99caff', '#66afff', '#3395ff', '#0a84ff', '#007aff', '#006be0', '#005dc2', '#004ea3'];
const indigo: MantineColorsTuple = ['#eeeefb', '#deddf7', '#bcbbef', '#9b9ae6', '#7978de', '#5e5ce6', '#5856d6', '#4d4cbc', '#4341a3', '#383789'];
const grape: MantineColorsTuple = ['#f7eefc', '#efdcf8', '#dfbaf2', '#cf97eb', '#bf75e5', '#bf5af2', '#af52de', '#9a48c3', '#853ea9', '#70348e'];
const pink: MantineColorsTuple = ['#ffeaee', '#ffd5dd', '#ffabbb', '#ff8199', '#ff5777', '#ff375f', '#ff2d55', '#e0284b', '#c22241', '#a31d36'];
const yellow: MantineColorsTuple = ['#fffae6', '#fff5cc', '#ffeb99', '#ffe066', '#ffd633', '#ffd60a', '#ffcc00', '#e0b400', '#c29b00', '#a38300'];
// iOS mint: "ready — hand it over".
const teal: MantineColorsTuple = ['#e6f9f9', '#ccf4f2', '#99e9e5', '#66ddd8', '#33d2cb', '#63e6e2', '#00c7be', '#00afa7', '#009790', '#007f7a'];
const cyan: MantineColorsTuple = ['#ebf7fd', '#d6effa', '#addef5', '#84cef0', '#5bbdeb', '#64d2ff', '#32ade6', '#2c98ca', '#2683af', '#206f93'];

export const FONT_UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Headings and large numbers: the same system face (SF Pro Display on iPhone). */
export const FONT_DISPLAY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Big figures (cash, counts): the rounded system face where the phone has one (SF Rounded). */
export const FONT_ROUNDED = 'ui-rounded, -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", Roboto, sans-serif';
/** Only the UAE number plate keeps a condensed face, like the real plate. */
export const FONT_PLATE = 'Oswald, "Arial Narrow", sans-serif';

/** The push and sheet curve of UIKit. */
export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';

const inputStyles = { label: { fontWeight: 500, marginBottom: rem(6) }, description: { marginTop: 0 }, input: { borderRadius: rem(12) } };
/** iOS 26 controls are capsules whatever their height. */
const CAPSULE = '999px';
const inputDefaults = { size: 'md', variant: 'filled' } as const;

export const theme = createTheme({
  primaryColor: 'cobalt',
  primaryShade: { light: 6, dark: 5 },
  colors: { cobalt, gray, dark, green, red, orange, blue, indigo, grape, pink, yellow, teal, cyan },
  black: '#1c1c1e',
  fontFamily: FONT_UI,
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: {
    fontFamily: FONT_DISPLAY,
    fontWeight: '700',
    sizes: {
      h1: { fontSize: rem(34), lineHeight: '1.18' },
      h2: { fontSize: rem(28), lineHeight: '1.2' },
      h3: { fontSize: rem(22), lineHeight: '1.25' },
      h4: { fontSize: rem(20), lineHeight: '1.25' },
      h5: { fontSize: rem(17), lineHeight: '1.3' },
      h6: { fontSize: rem(15), lineHeight: '1.35' },
    },
  },
  // 16 px body on a PC; on a phone every field is 17 px (styles.css) — iPhone Safari zooms into smaller ones.
  fontSizes: { xs: rem(12), sm: rem(14), md: rem(16), lg: rem(18), xl: rem(21) },
  lineHeights: { xs: '1.35', sm: '1.4', md: '1.45', lg: '1.45', xl: '1.35' },
  // iOS 26 corners: 12 for fields and small cards, 24 for inset groups and cards, 32 for dialogs.
  radius: { xs: rem(6), sm: rem(10), md: rem(12), lg: rem(24), xl: rem(32) },
  defaultRadius: 'md',
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(20), xl: rem(28) },
  shadows: {
    xs: 'none',
    sm: 'none',
    md: '0 4px 16px rgba(0, 0, 0, 0.08)',
    lg: '0 12px 36px rgba(0, 0, 0, 0.14)',
    xl: '0 20px 56px rgba(0, 0, 0, 0.18)',
  },
  cursorType: 'pointer',
  focusRing: 'auto',
  components: {
    // iOS 26 buttons: capsules, 44 pt tall (52 for the main action), semibold label.
    Button: Button.extend({
      defaultProps: { size: 'md' },
      vars: (_theme, props) => {
        if (props.size === 'lg') return { root: { '--button-height': rem(52), '--button-fz': rem(17), '--button-radius': CAPSULE, '--button-padding-x': rem(22) } };
        if (props.size === 'md' || !props.size) return { root: { '--button-height': rem(44), '--button-fz': rem(16), '--button-radius': CAPSULE, '--button-padding-x': rem(18) } };
        return { root: { '--button-radius': CAPSULE } };
      },
      styles: { root: { fontWeight: 600 }, label: { overflow: 'visible' } },
    }),
    ActionIcon: ActionIcon.extend({ vars: () => ({ root: { '--ai-radius': CAPSULE } }) }),
    Badge: Badge.extend({
      defaultProps: { radius: 'xl', variant: 'light' },
      styles: { root: { textTransform: 'none', fontWeight: 600, letterSpacing: 0, flexShrink: 0 } },
    }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
    Card: Card.extend({ defaultProps: { radius: 'lg' } }),
    TextInput: TextInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    PasswordInput: PasswordInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    Textarea: Textarea.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    NumberInput: NumberInput.extend({ defaultProps: { ...inputDefaults, hideControls: true }, styles: inputStyles }),
    Select: Select.extend({ defaultProps: { ...inputDefaults, comboboxProps: { shadow: 'lg', radius: 'lg' } }, styles: inputStyles }),
    Autocomplete: Autocomplete.extend({ defaultProps: { ...inputDefaults, comboboxProps: { shadow: 'lg', radius: 'lg' } }, styles: inputStyles }),
    TagsInput: TagsInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    DateTimePicker: DateTimePicker.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    DatePickerInput: DatePickerInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    MonthPickerInput: MonthPickerInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    Checkbox: Checkbox.extend({ defaultProps: { radius: 'sm' } }),
    // iOS switches: 51 × 31, green when on.
    Switch: Switch.extend({ defaultProps: { size: 'lg', color: 'green' } }),
    Chip: Chip.extend({ defaultProps: { radius: 'xl' } }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { radius: 999, size: 'sm' },
      styles: { root: { padding: 2 }, label: { fontWeight: 600, fontSize: rem(13) } },
    }),
    Tabs: Tabs.extend({ styles: { tab: { fontWeight: 600 } } }),
    Modal: Modal.extend({
      defaultProps: {
        radius: 'xl',
        centered: true,
        overlayProps: { backgroundOpacity: 0.4, blur: 0 },
        transitionProps: { transition: 'pop', duration: 200, timingFunction: EASE_IOS },
      },
      classNames: { root: 'mg-sheet' },
      styles: { title: { fontWeight: 700, fontSize: rem(17), lineHeight: 1.3, letterSpacing: '-0.015em' }, header: { paddingBottom: rem(8) } },
    }),
    Drawer: Drawer.extend({
      defaultProps: { overlayProps: { backgroundOpacity: 0.4, blur: 0 }, transitionProps: { duration: 320, timingFunction: EASE_IOS } },
    }),
    // Context menus: rounded glass, 17 pt rows, like the iOS 26 ones.
    Menu: Menu.extend({
      defaultProps: { shadow: 'lg', radius: 'lg', withinPortal: true, transitionProps: { transition: 'pop-top-right', duration: 180, timingFunction: EASE_IOS } },
      styles: { dropdown: { padding: 6 }, item: { fontSize: rem(17), padding: `${rem(11)} ${rem(14)}`, borderRadius: rem(16) }, divider: { marginBlock: 4 } },
    }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: 'sm', withArrow: true } }),
    Alert: Alert.extend({ defaultProps: { radius: 'lg', variant: 'light' }, styles: { title: { fontWeight: 600 } } }),
    Progress: Progress.extend({ defaultProps: { radius: 'xl', transitionDuration: 400 } }),
    NavLink: NavLink.extend({ styles: { label: { fontWeight: 500 } } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: 'sm' } }),
  },
});

/**
 * On phones dialogs open as bottom sheets (closer to the thumb): they rise from the bottom edge on
 * UIKit's curve. The sheet geometry itself is in styles.css (`.mg-sheet`).
 */
const phoneOverrides = createTheme({
  components: {
    Modal: Modal.extend({
      defaultProps: { transitionProps: { transition: 'slide-up', duration: 440, exitDuration: 280, timingFunction: EASE_IOS } },
    }),
  },
});

export const phoneTheme = mergeThemeOverrides(theme, phoneOverrides);

/** App-level CSS variables: the iOS system colours in both appearances. */
export const cssResolver: CSSVariablesResolver = () => ({
  variables: {
    '--font-display': FONT_DISPLAY,
    '--font-rounded': FONT_ROUNDED,
    '--font-plate': FONT_PLATE,
    // The floating tab bar (iOS 26): a 62 pt capsule 21 pt off the screen edges.
    '--app-bottom-h': '62px',
    '--bar-inset': '21px',
    // Navigation bar: room for the 44 pt round glass buttons.
    '--app-nav-h': '52px',
    '--radius-group': '24px',
    '--glass-blur': 'blur(18px) saturate(190%)',
  },
  light: {
    '--app-canvas': '#f2f2f7',
    '--app-card': '#ffffff',
    '--app-soft': '#f2f2f7',
    '--app-fill': 'rgba(118, 118, 128, 0.12)',
    '--app-press': 'rgba(60, 60, 67, 0.1)',
    '--app-hairline': 'rgba(60, 60, 67, 0.2)',
    '--app-label-2': 'rgba(60, 60, 67, 0.6)',
    '--app-label-3': 'rgba(60, 60, 67, 0.3)',
    '--app-tab-idle': '#8e8e93',
    '--app-grabber': 'rgba(60, 60, 67, 0.3)',
    '--app-bar': 'rgba(249, 249, 249, 0.84)',
    '--app-pill': '#1c1c1e',
    '--app-pill-text': '#ffffff',
    // Liquid Glass: a bright translucent body, a light rim on top, a soft shadow under it.
    '--glass-bg': 'rgba(255, 255, 255, 0.66)',
    '--glass-bg-strong': 'rgba(255, 255, 255, 0.84)',
    '--glass-rim': 'rgba(255, 255, 255, 0.95)',
    '--glass-edge': 'rgba(0, 0, 0, 0.07)',
    '--glass-shadow': '0 8px 28px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06)',
    '--glass-lens': 'rgba(118, 118, 128, 0.16)',
    '--viz-1': '#007aff',
    '--viz-2': '#ff9500',
    '--viz-3': '#34c759',
    // In daylight (the light theme is the day in Dubai) green and orange buttons take the deeper shade
    // ("Increase contrast" of iOS): white words on them, and green or orange words on a pale tint, stay
    // readable in the sun.
    '--mantine-color-green-filled': 'var(--mantine-color-green-8)',
    '--mantine-color-green-filled-hover': 'var(--mantine-color-green-9)',
    '--mantine-color-green-light-color': 'var(--mantine-color-green-8)',
    '--mantine-color-orange-filled': 'var(--mantine-color-orange-8)',
    '--mantine-color-orange-filled-hover': 'var(--mantine-color-orange-9)',
    '--mantine-color-orange-light-color': 'var(--mantine-color-orange-8)',
    // Mint and yellow are too pale for words on white: their words and filled buttons take deep shades.
    '--mantine-color-teal-filled': 'var(--mantine-color-teal-8)',
    '--mantine-color-teal-light-color': 'var(--mantine-color-teal-8)',
    '--mantine-color-yellow-light-color': 'var(--mantine-color-yellow-9)',
    '--mantine-color-cyan-light-color': 'var(--mantine-color-cyan-8)',
  },
  dark: {
    '--app-canvas': '#000000',
    '--app-card': '#1c1c1e',
    '--app-soft': '#2c2c2e',
    '--app-fill': 'rgba(118, 118, 128, 0.24)',
    '--app-press': 'rgba(235, 235, 245, 0.12)',
    '--app-hairline': 'rgba(84, 84, 88, 0.6)',
    '--app-label-2': 'rgba(235, 235, 245, 0.6)',
    '--app-label-3': 'rgba(235, 235, 245, 0.3)',
    '--app-tab-idle': '#7d7d82',
    '--app-grabber': 'rgba(235, 235, 245, 0.3)',
    '--app-bar': 'rgba(22, 22, 24, 0.82)',
    '--app-pill': '#f2f2f7',
    '--app-pill-text': '#000000',
    // Tinted words in the dark (text buttons, tinted buttons, badges) are the saturated system colours
    // of iOS, not Mantine's near-white shades.
    '--mantine-color-cobalt-light-color': 'var(--mantine-color-cobalt-4)',
    '--mantine-color-green-light-color': 'var(--mantine-color-green-5)',
    '--mantine-color-red-light-color': 'var(--mantine-color-red-4)',
    '--mantine-color-orange-light-color': 'var(--mantine-color-orange-5)',
    '--mantine-color-blue-light-color': 'var(--mantine-color-blue-5)',
    '--mantine-color-indigo-light-color': 'var(--mantine-color-indigo-4)',
    '--mantine-color-grape-light-color': 'var(--mantine-color-grape-5)',
    '--mantine-color-pink-light-color': 'var(--mantine-color-pink-5)',
    '--mantine-color-yellow-light-color': 'var(--mantine-color-yellow-5)',
    '--mantine-color-teal-light-color': 'var(--mantine-color-teal-5)',
    '--mantine-color-cyan-light-color': 'var(--mantine-color-cyan-5)',
    '--glass-bg': 'rgba(48, 48, 52, 0.6)',
    '--glass-bg-strong': 'rgba(40, 40, 44, 0.86)',
    '--glass-rim': 'rgba(255, 255, 255, 0.16)',
    '--glass-edge': 'rgba(255, 255, 255, 0.08)',
    '--glass-shadow': '0 8px 28px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0, 0, 0, 0.3)',
    '--glass-lens': 'rgba(255, 255, 255, 0.14)',
    '--viz-1': '#0a84ff',
    '--viz-2': '#ff9f0a',
    '--viz-3': '#30d158',
  },
});
