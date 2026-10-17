import { Outlet } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import CallOverlay from '../components/CallOverlay';
import { useOrderRealtime } from '../realtime/useOrderRealtime';
import { useVoip } from '../voip/useVoip';

export default function MainLayout() {
  useOrderRealtime();
  useVoip();

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f8f7]">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <Footer />
      <CallOverlay />
    </div>
  );
}
