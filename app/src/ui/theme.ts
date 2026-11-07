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
 * MyGarage design tokens — "light, like iOS".
 * Grey grouped canvas, white rounded groups without borders or shadows, one blue accent,
 * the phone's own system font (SF Pro on iPhone, Roboto on Android, Segoe UI on Windows),
 * large screen titles, translucent bars. Status colours are semantic only.
 * The palette keeps the key "cobalt" for the primary colour so existing code keeps working.
 */

// Primary: iOS system blue (#007AFF light, #0A84FF dark).
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
/** Numbers use the same system face with tabular figures (SF Pro digits on iPhone). */
export const FONT_DISPLAY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Only the UAE number plate keeps a condensed face, like the real plate. */
export const FONT_PLATE = 'Oswald, "Arial Narrow", sans-serif';

const inputStyles = { label: { fontWeight: 500, marginBottom: rem(6) }, description: { marginTop: 0 } };
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
      h1: { fontSize: rem(32), lineHeight: '1.12' },
      h2: { fontSize: rem(26), lineHeight: '1.18' },
      h3: { fontSize: rem(20), lineHeight: '1.25' },
      h4: { fontSize: rem(18), lineHeight: '1.3' },
      h5: { fontSize: rem(17), lineHeight: '1.3' },
      h6: { fontSize: rem(14), lineHeight: '1.4' },
    },
  },
  // 16 px body text: also stops iPhone Safari from zooming into a focused input.
  fontSizes: { xs: rem(12), sm: rem(14), md: rem(16), lg: rem(18), xl: rem(21) },
  lineHeights: { xs: '1.35', sm: '1.4', md: '1.45', lg: '1.45', xl: '1.35' },
  radius: { xs: rem(6), sm: rem(8), md: rem(12), lg: rem(16), xl: rem(22) },
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
    Button: Button.extend({
      defaultProps: { size: 'md' },
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
    Select: Select.extend({ defaultProps: { ...inputDefaults, comboboxProps: { shadow: 'lg', radius: 'md' } }, styles: inputStyles }),
    Autocomplete: Autocomplete.extend({ defaultProps: { ...inputDefaults, comboboxProps: { shadow: 'lg', radius: 'md' } }, styles: inputStyles }),
    TagsInput: TagsInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    DateTimePicker: DateTimePicker.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    DatePickerInput: DatePickerInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    MonthPickerInput: MonthPickerInput.extend({ defaultProps: inputDefaults, styles: inputStyles }),
    Checkbox: Checkbox.extend({ defaultProps: { radius: 'sm' } }),
    // iOS switches are green when on.
    Switch: Switch.extend({ defaultProps: { size: 'md', color: 'green' } }),
    Chip: Chip.extend({ defaultProps: { radius: 'xl' } }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { radius: 'md', size: 'sm' },
      styles: { root: { padding: 3 }, label: { fontWeight: 600 } },
    }),
    Tabs: Tabs.extend({ styles: { tab: { fontWeight: 600 } } }),
    Modal: Modal.extend({
      defaultProps: {
        radius: 'lg',
        centered: true,
        overlayProps: { backgroundOpacity: 0.35, blur: 2 },
        transitionProps: { transition: 'pop', duration: 180, timingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      },
      classNames: { root: 'mg-sheet' },
      styles: { title: { fontWeight: 700, fontSize: rem(18), lineHeight: 1.3 }, header: { paddingBottom: rem(8) } },
    }),
    Drawer: Drawer.extend({
      defaultProps: { overlayProps: { backgroundOpacity: 0.35, blur: 2 }, transitionProps: { duration: 240, timingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } },
    }),
    Menu: Menu.extend({ defaultProps: { shadow: 'lg', radius: 'md', withinPortal: true, transitionProps: { transition: 'pop', duration: 140 } } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: 'sm', withArrow: true } }),
    Alert: Alert.extend({ defaultProps: { radius: 'lg', variant: 'light' }, styles: { title: { fontWeight: 600 } } }),
    Progress: Progress.extend({ defaultProps: { radius: 'xl', transitionDuration: 400 } }),
    NavLink: NavLink.extend({ styles: { label: { fontWeight: 500 } } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: 'sm' } }),
  },
});

/**
 * On phones dialogs open as bottom sheets (closer to the thumb): they slide up from the bottom edge.
 * The sheet geometry itself is in styles.css (`.mg-sheet`).
 */
const phoneOverrides = createTheme({
  components: {
    Modal: Modal.extend({
      defaultProps: { transitionProps: { transition: 'slide-up', duration: 260, timingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } },
    }),
  },
});

export const phoneTheme = mergeThemeOverrides(theme, phoneOverrides);

/** App-level CSS variables: grouped canvas, white groups, hairlines, translucent bars. */
export const cssResolver: CSSVariablesResolver = () => ({
  variables: {
    '--font-display': FONT_DISPLAY,
    '--font-plate': FONT_PLATE,
    '--app-bottom-h': '60px',
    '--app-nav-h': '48px',
  },
  light: {
    '--app-canvas': '#f2f2f7',
    '--app-card': '#ffffff',
    '--app-soft': '#f2f2f7',
    '--app-fill': '#efeff4',
    '--app-hairline': 'rgba(60, 60, 67, 0.14)',
    '--app-label-2': 'rgba(60, 60, 67, 0.6)',
    '--app-bar': 'rgba(249, 249, 251, 0.86)',
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
    '--app-fill': '#2c2c2e',
    '--app-hairline': 'rgba(84, 84, 88, 0.55)',
    '--app-label-2': 'rgba(235, 235, 245, 0.6)',
    '--app-bar': 'rgba(22, 22, 24, 0.84)',
    '--app-pill': '#f2f2f7',
    '--app-pill-text': '#000000',
    '--viz-1': '#0a84ff',
    '--viz-2': '#ff9f0a',
    '--viz-3': '#30d158',
  },
});
