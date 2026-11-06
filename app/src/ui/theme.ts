import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  createTheme,
  Drawer,
  Menu,
  Modal,
  NavLink,
  NumberInput,
  Paper,
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

/*
 * MyGarage design tokens.
 * Layout concept: an ink "control panel" frame (top bar / side rail) around a cool light canvas,
 * white job cards with soft depth instead of borders everywhere, numbers set in a condensed
 * automotive face. Primary is a deep cobalt; status colours are semantic only.
 */

// Primary: deep cobalt (not the default sky blue).
const cobalt: MantineColorsTuple = [
  '#eef1ff',
  '#dde3ff',
  '#b8c5ff',
  '#91a5ff',
  '#6f88fb',
  '#5873f4',
  '#3f5be9',
  '#304acd',
  '#263ca6',
  '#1c2d80',
];

// Neutrals with a slight blue bias.
const slate: MantineColorsTuple = [
  '#f6f7f9',
  '#eef0f4',
  '#e3e7ed',
  '#cfd5de',
  '#abb3c0',
  '#818a9a',
  '#606a7b',
  '#454e5e',
  '#2d3442',
  '#171c27',
];

// Dark mode surfaces (same blue bias).
const dark: MantineColorsTuple = [
  '#cdd3de',
  '#a8b1c0',
  '#808a9b',
  '#5d6779',
  '#3b4354',
  '#2c3341',
  '#232935',
  '#1b202a',
  '#151922',
  '#0e1118',
];

export const FONT_UI = '"Golos Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_DISPLAY = 'Oswald, "Golos Text", "Arial Narrow", sans-serif';

export const theme = createTheme({
  primaryColor: 'cobalt',
  primaryShade: { light: 6, dark: 5 },
  colors: { cobalt, gray: slate, dark },
  black: '#121722',
  fontFamily: FONT_UI,
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: {
    fontFamily: FONT_UI,
    fontWeight: '700',
    sizes: {
      h1: { fontSize: rem(28), lineHeight: '1.15' },
      h2: { fontSize: rem(22), lineHeight: '1.2' },
      h3: { fontSize: rem(19), lineHeight: '1.25' },
      h4: { fontSize: rem(17), lineHeight: '1.3' },
      h5: { fontSize: rem(15), lineHeight: '1.35' },
      h6: { fontSize: rem(13), lineHeight: '1.4' },
    },
  },
  fontSizes: { xs: rem(12), sm: rem(14), md: rem(15), lg: rem(17), xl: rem(20) },
  lineHeights: { xs: '1.4', sm: '1.45', md: '1.5', lg: '1.5', xl: '1.4' },
  radius: { xs: rem(4), sm: rem(8), md: rem(10), lg: rem(14), xl: rem(20) },
  defaultRadius: 'md',
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(20), xl: rem(28) },
  shadows: {
    xs: '0 1px 2px rgba(18, 23, 34, 0.05)',
    sm: '0 1px 2px rgba(18, 23, 34, 0.05), 0 2px 6px rgba(18, 23, 34, 0.05)',
    md: '0 2px 4px rgba(18, 23, 34, 0.05), 0 8px 20px rgba(18, 23, 34, 0.08)',
    lg: '0 4px 8px rgba(18, 23, 34, 0.06), 0 16px 40px rgba(18, 23, 34, 0.12)',
    xl: '0 8px 16px rgba(18, 23, 34, 0.08), 0 24px 64px rgba(18, 23, 34, 0.16)',
  },
  cursorType: 'pointer',
  focusRing: 'auto',
  components: {
    Button: Button.extend({
      defaultProps: { size: 'md' },
      styles: { root: { fontWeight: 600 }, label: { overflow: 'visible' } },
    }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'md' } }),
    Badge: Badge.extend({
      defaultProps: { radius: 'sm', variant: 'light' },
      styles: { root: { textTransform: 'none', fontWeight: 600, letterSpacing: 0, flexShrink: 0 } },
    }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
    Card: Card.extend({ defaultProps: { radius: 'lg' } }),
    TextInput: TextInput.extend({ defaultProps: { size: 'md' } }),
    Textarea: Textarea.extend({ defaultProps: { size: 'md' } }),
    NumberInput: NumberInput.extend({ defaultProps: { size: 'md', hideControls: true } }),
    Select: Select.extend({ defaultProps: { size: 'md', comboboxProps: { shadow: 'lg', radius: 'md' } } }),
    TagsInput: TagsInput.extend({ defaultProps: { size: 'md' } }),
    Checkbox: Checkbox.extend({ defaultProps: { radius: 'sm' } }),
    Switch: Switch.extend({ defaultProps: { size: 'md' } }),
    Chip: Chip.extend({ defaultProps: { radius: 'xl' } }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { radius: 'md', size: 'sm' },
      styles: { root: { padding: 3 }, label: { fontWeight: 600 } },
    }),
    Tabs: Tabs.extend({ styles: { tab: { fontWeight: 600 } } }),
    Modal: Modal.extend({
      defaultProps: { radius: 'lg', centered: true, overlayProps: { backgroundOpacity: 0.45, blur: 3 }, transitionProps: { transition: 'pop', duration: 160 } },
      styles: { title: { fontWeight: 700, fontSize: rem(17) }, header: { paddingBottom: rem(8) } },
    }),
    Drawer: Drawer.extend({ defaultProps: { overlayProps: { backgroundOpacity: 0.45, blur: 3 } } }),
    Menu: Menu.extend({ defaultProps: { shadow: 'lg', radius: 'md', withinPortal: true } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: 'sm', withArrow: true } }),
    Alert: Alert.extend({ defaultProps: { radius: 'md', variant: 'light' }, styles: { title: { fontWeight: 700 } } }),
    Progress: Progress.extend({ defaultProps: { radius: 'xl' } }),
    NavLink: NavLink.extend({ styles: { label: { fontWeight: 600 } } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: 'sm' } }),
  },
});

/** App-level CSS variables (canvas behind cards, ink frame). */
export const cssResolver: CSSVariablesResolver = () => ({
  variables: {
    '--font-display': FONT_DISPLAY,
    '--app-header-h': '56px',
    '--app-bottom-h': '68px',
  },
  light: {
    '--app-canvas': '#f2f4f8',
    '--app-ink': '#0f1626',
    '--app-ink-2': '#18213a',
    '--app-ink-text': '#e9edf6',
    '--app-ink-muted': '#8f9bb6',
    '--app-hairline': '#e4e8ef',
    '--app-card': '#ffffff',
    '--app-soft': '#f6f7fa',
    '--viz-1': '#3f5be9',
    '--viz-2': '#eb6834',
    '--viz-3': '#1baf7a',
  },
  dark: {
    '--app-canvas': '#0e1118',
    '--app-ink': '#0a0d14',
    '--app-ink-2': '#141a28',
    '--app-ink-text': '#e9edf6',
    '--app-ink-muted': '#8792ab',
    '--app-hairline': '#262c39',
    '--app-card': '#1b202a',
    '--app-soft': '#202633',
    '--viz-1': '#5873f4',
    '--viz-2': '#d95926',
    '--viz-3': '#199e70',
  },
});
