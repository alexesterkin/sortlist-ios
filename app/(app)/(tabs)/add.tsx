import { Redirect } from 'expo-router';

// The center "+" button in the tab bar is intercepted in
// (tabs)/_layout.tsx's `listeners.tabPress` and routed to the modal at
// /(app)/add. This file exists only because expo-router needs a route
// to register the slot. If a user ever somehow lands on /(app)/(tabs)/add
// directly (deep link drift, programmatic mistake), redirect them to
// the modal instead of rendering a blank screen.
export default function AddTabRedirect() {
  return <Redirect href={'/(app)/add' as never} />;
}
