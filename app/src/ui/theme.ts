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
 * MyGarage design tokens — a native iPhone app, built with the web.
 * The iOS system palette: grouped grey canvas, white inset groups with 12 px corners and no borders
 * or shadows, hairline separators, one blue tint, semantic colours for status only. Type is the
 * phone's own system face (SF Pro on iPhone, Roboto on Android, Segoe UI on Windows) at the iOS
 * sizes: 34 large title, 17 body, 15 secondary, 13 footnote. Bars are translucent and blurred.
 * The palette keeps the key "cobalt" for the tint so existing code keeps working.
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

export const FONT_UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Headings and large numbers: the same system face (SF Pro Display on iPhone). */
export const FONT_DISPLAY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Big figures (cash, counts): the rounded system face where the phone has one (SF Rounded). */
export const FONT_ROUNDED = 'ui-rounded, -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", Roboto, sans-serif';
/** Only the UAE number plate keeps a condensed face, like the real plate. */
export const FONT_PLATE = 'Oswald, "Arial Narrow", sans-serif';

/** The push and sheet curve of UIKit. */
export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';

const inputStyles = { label: { fontWeight: 500, marginBottom: rem(6) }, description: { marginTop: 0 }, input: { borderRadius: rem(10) } };
const inputDefaults = { size: 'md', variant: 'filled' } as const;

export const theme = createTheme({
  primaryColor: 'cobalt',
  primaryShade: { light: 6, dark: 5 },
  colors: { cobalt, gray, dark, green, red, orange },
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
  // iOS corners: 10 for fields and small cards, 12 for inset groups, 18 for sheets and big cards.
  radius: { xs: rem(6), sm: rem(8), md: rem(10), lg: rem(12), xl: rem(18) },
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
    // iOS buttons: 46 pt tall (50 for the main action), 12 pt corners, semibold label.
    Button: Button.extend({
      defaultProps: { size: 'md' },
      vars: (_theme, props) => {
        if (props.size === 'lg') return { root: { '--button-height': rem(50), '--button-fz': rem(17), '--button-radius': rem(14), '--button-padding-x': rem(20) } };
        if (props.size === 'md' || !props.size) return { root: { '--button-height': rem(46), '--button-fz': rem(16), '--button-radius': rem(12), '--button-padding-x': rem(18) } };
        return { root: {} };
      },
      styles: { root: { fontWeight: 600 }, label: { overflow: 'visible' } },
    }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'xl' } }),
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
      defaultProps: { radius: 9, size: 'sm' },
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
      styles: { title: { fontWeight: 600, fontSize: rem(17), lineHeight: 1.3 }, header: { paddingBottom: rem(8) } },
    }),
    Drawer: Drawer.extend({
      defaultProps: { overlayProps: { backgroundOpacity: 0.4, blur: 0 }, transitionProps: { duration: 320, timingFunction: EASE_IOS } },
    }),
    // Context menus: rounded, blurred, 17 pt rows, like the iOS ones.
    Menu: Menu.extend({
      defaultProps: { shadow: 'lg', radius: 'lg', withinPortal: true, transitionProps: { transition: 'pop-top-right', duration: 160, timingFunction: EASE_IOS } },
      styles: { dropdown: { padding: 4 }, item: { fontSize: rem(16), padding: `${rem(10)} ${rem(12)}`, borderRadius: rem(9) }, divider: { marginBlock: 4 } },
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
    '--app-bottom-h': '50px',
    '--app-nav-h': '44px',
    '--radius-group': '12px',
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
    '--viz-1': '#007aff',
    '--viz-2': '#ff9500',
    '--viz-3': '#34c759',
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
    '--viz-1': '#0a84ff',
    '--viz-2': '#ff9f0a',
    '--viz-3': '#30d158',
  },
});
