import React, { useState, useEffect } from 'react';
import { SettingsProvider, useSettings } from './context/SettingsContext.tsx';
import { CartProvider } from './context/CartContext.tsx';
import { WishlistProvider } from './context/WishlistContext.tsx';
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext.tsx';
import { saveClientProducts } from './data/fallbackData.ts';
import { subscribeToProducts } from './services/firestoreSync.ts';

// Common Components
import { Header } from './components/common/Header.tsx';
import { Footer } from './components/common/Footer.tsx';
import { CartDrawer } from './components/common/CartDrawer.tsx';

// Public Storefront Pages
import { HomePage } from './components/home/HomePage.tsx';
import { CatalogPage } from './components/catalog/CatalogPage.tsx';
import { ProductDetailPage } from './components/product/ProductDetailPage.tsx';
import { CheckoutPage } from './components/checkout/CheckoutPage.tsx';
import { OrderConfirmationPage } from './components/checkout/OrderConfirmationPage.tsx';
import { OrderTrackingPage } from './components/tracking/OrderTrackingPage.tsx';
import { WishlistPage } from './components/wishlist/WishlistPage.tsx';
import { ContactPage } from './components/contact/ContactPage.tsx';
import { PolicyPages } from './components/pages/PolicyPages.tsx';

// Admin Panel Components
import { AdminLogin } from './components/admin/AdminLogin.tsx';
import { AdminLayout } from './components/admin/AdminLayout.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';
import { AdminProducts } from './components/admin/AdminProducts.tsx';
import { AdminOrders } from './components/admin/AdminOrders.tsx';
import { AdminBanners } from './components/admin/AdminBanners.tsx';
import { AdminCategories } from './components/admin/AdminCategories.tsx';
import { AdminSettings } from './components/admin/AdminSettings.tsx';
import { AdminCoupons } from './components/admin/AdminCoupons.tsx';
import { AdminMessages } from './components/admin/AdminMessages.tsx';
import { AdminSecurity } from './components/admin/AdminSecurity.tsx';
import { AdminErrorBoundary } from './components/admin/AdminErrorBoundary.tsx';
import { Order } from './types/index.ts';

import { MessageCircle } from 'lucide-react';

function AppContent() {
  const { settings } = useSettings();
  const { isAuthenticated, loading: authLoading } = useAdminAuth();

  // Navigation State
  const [currentPage, setCurrentPage] = useState<string>('home');
  const [pageParams, setPageParams] = useState<any>({});
  const [adminTab, setAdminTab] = useState<string>('dashboard');
  const [selectedOrderForInvoice, setSelectedOrderForInvoice] = useState<Order | null>(null);

  // Global real-time Firestore product sync across all devices
  useEffect(() => {
    const unsubscribe = subscribeToProducts((items) => {
      saveClientProducts(items);
      window.dispatchEvent(new Event('storage'));
    });
    return () => unsubscribe();
  }, []);

  // Parse Hash on initial load
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('sync=')) {
        try {
          const encoded = hash.replace('sync=', '');
          const decoded = JSON.parse(decodeURIComponent(encoded));
          if (Array.isArray(decoded)) {
            saveClientProducts(decoded);
            window.dispatchEvent(new Event('storage'));
            alert('✨ Mobile Device Successfully Synced with PC Catalog! All products are now updated.');
            window.location.hash = '/';
            setCurrentPage('home');
          }
        } catch {
          alert('Sync link invalid.');
        }
        return;
      }

      if (hash.startsWith('/admin')) {
        if (hash === '/admin/login') {
          setCurrentPage('admin-login');
        } else {
          setCurrentPage('admin-dashboard');
        }
      } else if (hash.startsWith('/product/')) {
        const id = hash.replace('/product/', '');
        setCurrentPage('product');
        setPageParams({ id });
      } else if (hash.startsWith('/shop')) {
        setCurrentPage('shop');
      } else if (hash === '/cart') {
        setCurrentPage('checkout');
      } else if (hash === '/track') {
        setCurrentPage('track');
      } else if (hash === '/contact') {
        setCurrentPage('contact');
      } else if (hash === '/wishlist') {
        setCurrentPage('wishlist');
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateTo = (page: string, params: any = {}) => {
    setCurrentPage(page);
    setPageParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Sync hash
    if (page === 'home') {
      window.location.hash = '/';
    } else if (page === 'admin-dashboard') {
      window.location.hash = '/admin/dashboard';
    } else if (page === 'admin-login') {
      window.location.hash = '/admin/login';
    } else if (page === 'product' && params.id) {
      window.location.hash = `/product/${params.id}`;
    } else if (page === 'shop') {
      window.location.hash = '/shop';
    } else if (page === 'track') {
      window.location.hash = '/track';
    } else if (page === 'contact') {
      window.location.hash = '/contact';
    } else if (page === 'wishlist') {
      window.location.hash = '/wishlist';
    } else if (page === 'checkout') {
      window.location.hash = '/checkout';
    }
  };

  // -------------------------------------------------------------
  // ADMIN PANEL ROUTING
  // -------------------------------------------------------------
  if (currentPage === 'admin-login') {
    return <AdminLogin onNavigate={navigateTo} />;
  }

  if (currentPage === 'admin-dashboard') {
    if (!isAuthenticated) {
      return <AdminLogin onNavigate={navigateTo} />;
    }

    const renderAdminModule = () => {
      switch (adminTab) {
        case 'dashboard':
          return (
            <AdminDashboard
              onTabChange={(tab) => setAdminTab(tab)}
              onNavigate={navigateTo}
              onSelectOrderForInvoice={(order) => {
                setSelectedOrderForInvoice(order);
                setAdminTab('orders');
              }}
            />
          );
        case 'products':
          return <AdminProducts />;
        case 'orders':
          return (
            <AdminOrders
              initialSelectedOrder={selectedOrderForInvoice}
            />
          );
        case 'banners':
          return <AdminBanners />;
        case 'categories':
          return <AdminCategories />;
        case 'coupons':
          return <AdminCoupons />;
        case 'settings':
          return <AdminSettings />;
        case 'messages':
          return <AdminMessages />;
        case 'security':
          return <AdminSecurity />;
        default:
          return (
            <AdminDashboard
              onTabChange={(tab) => setAdminTab(tab)}
              onNavigate={navigateTo}
            />
          );
      }
    };

    return (
      <AdminErrorBoundary onNavigate={navigateTo}>
        <AdminLayout
          currentTab={adminTab}
          onTabChange={(tab) => {
            setAdminTab(tab);
            if (tab !== 'orders') setSelectedOrderForInvoice(null);
          }}
          onNavigate={navigateTo}
        >
          {renderAdminModule()}
        </AdminLayout>
      </AdminErrorBoundary>
    );
  }

  // -------------------------------------------------------------
  // PUBLIC STOREFRONT ROUTING
  // -------------------------------------------------------------
  const renderPublicPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={navigateTo} />;
      case 'shop':
        return <CatalogPage initialFilters={pageParams} onNavigate={navigateTo} />;
      case 'product':
        return <ProductDetailPage productId={pageParams.id} onNavigate={navigateTo} />;
      case 'checkout':
        return <CheckoutPage onNavigate={navigateTo} />;
      case 'order-confirmation':
        return (
          <OrderConfirmationPage
            order={pageParams.order}
            whatsappUrl={pageParams.whatsappUrl}
            onNavigate={navigateTo}
          />
        );
      case 'track':
        return (
          <OrderTrackingPage
            initialOrderId={pageParams.orderId}
            initialPhone={pageParams.phone}
            onNavigate={navigateTo}
          />
        );
      case 'wishlist':
        return <WishlistPage onNavigate={navigateTo} />;
      case 'contact':
        return <ContactPage />;
      case 'policy-shipping':
        return <PolicyPages type="shipping" onNavigate={navigateTo} />;
      case 'policy-returns':
        return <PolicyPages type="returns" onNavigate={navigateTo} />;
      case 'policy-privacy':
        return <PolicyPages type="privacy" onNavigate={navigateTo} />;
      case 'policy-terms':
        return <PolicyPages type="terms" onNavigate={navigateTo} />;
      default:
        return <HomePage onNavigate={navigateTo} />;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-white text-slate-900 selection:bg-red-600 selection:text-white">
      {/* Global Store Header */}
      <Header onNavigate={navigateTo} currentPage={currentPage} />

      {/* Main Dynamic View */}
      <main className="flex-1">{renderPublicPage()}</main>

      {/* Global Shopping Bag Drawer */}
      <CartDrawer onNavigate={navigateTo} />

      {/* Global Store Footer */}
      <Footer onNavigate={navigateTo} />

      {/* Floating WhatsApp Contact Quick Action Button */}
      <a
        href={`https://wa.me/${settings.whatsappNumber.replace(/[^0-9]/g, '')}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-40 bg-emerald-600 hover:bg-emerald-500 text-white p-3.5 sm:px-4 sm:py-3 rounded-full shadow-2xl flex items-center gap-2 group transition-all duration-300 hover:scale-105"
        title="Chat with Footwear Box Lahore on WhatsApp"
      >
        <MessageCircle className="w-6 h-6 fill-white" />
        <span className="hidden sm:inline font-heading font-bold text-xs uppercase tracking-wider">
          Chat With Us
        </span>
      </a>
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AdminAuthProvider>
        <CartProvider>
          <WishlistProvider>
            <AppContent />
          </WishlistProvider>
        </CartProvider>
      </AdminAuthProvider>
    </SettingsProvider>
  );
}
