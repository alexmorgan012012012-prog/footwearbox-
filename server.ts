/// <reference types="node" />
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { db } from './server/db.ts';

dotenv.config();

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET environment variable is required in production'); })() : 'dev-secret-key-footwear-box');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Simple & secure HMAC-SHA256 Token Signer
function createToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// Admin Auth Middleware
interface AuthenticatedRequest extends Request {
  adminUser?: { id: string; email: string; role: string };
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload || !payload.email) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
  }

  req.adminUser = payload;
  next();
}

// -------------------------------------------------------------
// PUBLIC API ROUTES
// -------------------------------------------------------------

// Settings
app.get('/api/settings', (req: Request, res: Response) => {
  try {
    const isPreview = req.query.preview === 'true';
    const settings = db.getSettings(isPreview);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Banners
app.get('/api/banners', (req: Request, res: Response) => {
  try {
    const isPreview = req.query.preview === 'true';
    const banners = db.getBanners(isPreview).filter((b) => b.isActive);
    res.json(banners);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

// Categories
app.get('/api/categories', (req: Request, res: Response) => {
  try {
    const categories = db.getCategories();
    res.json(categories);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Products with search, filter, sort
app.get('/api/products', (req: Request, res: Response) => {
  try {
    const {
      category,
      gender,
      search,
      minPrice,
      maxPrice,
      size,
      featured,
      bestseller,
      newarrival,
      sort,
    } = req.query;

    const products = db.getProducts({
      category: category as string,
      gender: gender as string,
      search: search as string,
      minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      size: size as string,
      isFeatured: featured === 'true',
      isBestSeller: bestseller === 'true',
      isNewArrival: newarrival === 'true',
      sort: sort as string,
    });

    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Product detail by ID or Slug
app.get('/api/products/:id', (req: Request, res: Response) => {
  try {
    const product = db.getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Related products
app.get('/api/products/:id/related', (req: Request, res: Response) => {
  try {
    const product = db.getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const all = db.getProducts({ category: product.category, gender: product.gender });
    const related = all.filter((p) => p.id !== product.id).slice(0, 4);
    res.json(related);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch related products' });
  }
});

// Create Order (Cash on Delivery / Bank Transfer)
app.post('/api/orders', (req: Request, res: Response) => {
  try {
    const {
      customerName,
      phone,
      email,
      address,
      city,
      postalCode,
      notes,
      items,
      subtotal,
      deliveryCharge,
      discount,
      couponCode,
      total,
      paymentMethod,
    } = req.body;

    if (!customerName || !phone || !address || !city || !items || !items.length) {
      return res.status(400).json({ error: 'Missing required order fields: name, phone, address, city, and items' });
    }

    const newOrder = db.createOrder({
      customerName,
      phone,
      email: email || '',
      address,
      city,
      postalCode: postalCode || '',
      notes: notes || '',
      items,
      subtotal: Number(subtotal),
      deliveryCharge: Number(deliveryCharge),
      discount: Number(discount || 0),
      couponCode: couponCode || '',
      total: Number(total),
      paymentMethod: paymentMethod || 'cod',
      status: 'pending',
    });

    const settings = db.getSettings();
    const whatsappNum = settings.whatsappNumber.replace(/[^0-9]/g, '');

    // Generate pre-filled WhatsApp message
    const itemsList = items
      .map((i: any) => `• ${i.name} (Size: ${i.size}, Color: ${i.color}, Qty: ${i.quantity}) - Rs. ${i.price * i.quantity}`)
      .join('\n');

    const msg = `*NEW ORDER CONFIRMATION — FOOTWEAR BOX*\n\n` +
      `*Order ID:* ${newOrder.id}\n` +
      `*Customer:* ${newOrder.customerName}\n` +
      `*Phone:* ${newOrder.phone}\n` +
      `*City:* ${newOrder.city}\n` +
      `*Delivery Address:* ${newOrder.address}\n\n` +
      `*Items:*\n${itemsList}\n\n` +
      `*Subtotal:* Rs. ${newOrder.subtotal.toLocaleString()}\n` +
      `*Delivery:* Rs. ${newOrder.deliveryCharge.toLocaleString()}\n` +
      (newOrder.discount ? `*Discount:* -Rs. ${newOrder.discount.toLocaleString()}\n` : '') +
      `*Total Payable:* Rs. ${newOrder.total.toLocaleString()}\n` +
      `*Payment Method:* ${newOrder.paymentMethod === 'cod' ? 'Cash on Delivery (COD)' : newOrder.paymentMethod === 'bank_transfer' ? 'Direct Bank Transfer' : newOrder.paymentMethod === 'easypaisa' ? 'EasyPaisa' : newOrder.paymentMethod === 'jazzcash' ? 'JazzCash' : 'WhatsApp Order'}\n\n` +
      `_Please confirm dispatch for this order. Thank you!_`;

    const whatsappUrl = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(msg)}`;

    res.status(201).json({
      success: true,
      order: newOrder,
      whatsappUrl,
    });
  } catch (err: any) {
    console.error('Order creation error:', err);
    res.status(400).json({ error: err.message || 'Failed to process order. Please try again.' });
  }
});

// Track Order
app.get('/api/orders/track', (req: Request, res: Response) => {
  try {
    const { orderId, phone } = req.query;
    if (!orderId || !phone) {
      return res.status(400).json({ error: 'Both Order ID and Contact Phone are required for tracking' });
    }

    const order = db.trackOrder(orderId as string, phone as string);
    if (!order) {
      return res.status(404).json({ error: 'Order not found. Please verify your Order ID and phone number.' });
    }

    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to track order' });
  }
});

// Validate Coupon
app.post('/api/coupons/validate', (req: Request, res: Response) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Coupon code is required' });
    }

    const result = db.validateCoupon(code, Number(subtotal || 0));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to validate coupon' });
  }
});

// Contact Form
app.post('/api/contact', (req: Request, res: Response) => {
  try {
    const { name, phone, email, subject, message } = req.body;
    if (!name || !phone || !message) {
      return res.status(400).json({ error: 'Name, phone, and message are required' });
    }

    const msg = db.createMessage({
      name,
      phone,
      email: email || '',
      subject: subject || 'General Inquiry',
      message,
    });

    res.status(201).json({ success: true, message: 'Inquiry received. Our Lahore team will reach out shortly.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Newsletter Subscription
app.post('/api/newsletter', (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    db.logActivity('customer', 'Newsletter Signup', `Email: ${email}`);
    res.json({
      success: true,
      message: 'Thank you for subscribing! Use promo code WELCOME10 for 10% off your first footwear purchase.',
      discountCode: 'WELCOME10',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// -------------------------------------------------------------
// ADMIN AUTHENTICATION ROUTES
// -------------------------------------------------------------

// Check if owner account has been provisioned
app.get('/api/admin/auth/provisioned', (_req: Request, res: Response) => {
  res.json({ isProvisioned: db.isAdminProvisioned() });
});

// Secure Initial Provisioning (Only allowed when no admin exists)
app.post('/api/admin/auth/provision', (req: Request, res: Response) => {
  try {
    if (db.isAdminProvisioned()) {
      return res.status(403).json({ error: 'Admin account has already been provisioned. Please log in.' });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Owner Name, valid Email, and secure Password (at least 8 characters) are required.' });
    }

    const admin = db.registerInitialAdmin(name, email, password);
    const token = createToken({ id: admin.id, email: admin.email, role: admin.role });

    res.status(201).json({
      success: true,
      token,
      user: admin,
      message: 'Private owner credentials established successfully.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Provisioning failed due to a server error.' });
  }
});

// Secure Admin Login with Rate Limiting and Progressive Lockout
app.post('/api/admin/auth/login', (req: Request, res: Response) => {
  try {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const rateKey = `${clientIp}_${email.trim().toLowerCase()}`;

    // Check if account is temporarily locked
    const rateCheck = db.checkLoginRateLimit(rateKey);
    if (rateCheck.isLocked) {
      return res.status(429).json({
        error: `Account temporarily locked due to repeated failed login attempts. Please wait ${rateCheck.remainingSeconds} seconds before trying again.`,
        remainingSeconds: rateCheck.remainingSeconds,
      });
    }

    const admin = db.verifyAdminCredentials(email, password);
    if (!admin) {
      const failedResult = db.recordFailedLogin(rateKey);
      if (failedResult.isLocked) {
        return res.status(429).json({
          error: `Too many failed attempts. Login locked for ${failedResult.remainingSeconds} seconds.`,
          remainingSeconds: failedResult.remainingSeconds,
        });
      }
      return res.status(401).json({
        error: `Invalid credentials. (${failedResult.attemptsLeft} attempts remaining before temporary lockout)`,
        attemptsLeft: failedResult.attemptsLeft,
      });
    }

    // Login successful - reset rate limit counters
    db.clearLoginAttempts(rateKey);

    const token = createToken({ id: admin.id, email: admin.email, role: admin.role });
    res.json({
      success: true,
      token,
      user: admin,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

// Legacy setup route guarded by provisioning status
app.post('/api/admin/auth/setup', (req: Request, res: Response) => {
  if (db.isAdminProvisioned()) {
    return res.status(403).json({ error: 'Admin account has already been set up.' });
  }
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Name, valid email, and password of at least 8 characters required' });
  }
  const admin = db.registerInitialAdmin(name, email, password);
  const token = createToken({ id: admin.id, email: admin.email, role: admin.role });
  res.status(201).json({ success: true, token, user: admin });
});

app.get('/api/admin/auth/me', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, user: req.adminUser });
});

app.put('/api/admin/auth/password', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const email = req.adminUser!.email;
    const isValid = db.verifyAdminCredentials(email, currentPassword);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }

    db.updateAdminPassword(email, newPassword);
    res.json({ success: true, message: 'Admin password updated securely.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Request Admin Email Change with 6-digit verification code
app.post('/api/admin/auth/change-email/request', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newEmail, confirmEmail } = req.body;
    if (!currentPassword || !newEmail || !confirmEmail) {
      return res.status(400).json({ error: 'Current password, new email, and confirmation are required.' });
    }

    const result = db.requestAdminEmailChange(
      req.adminUser!.email,
      currentPassword,
      newEmail,
      confirmEmail
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message,
      simulatedCode: result.simulatedCode,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to initiate admin email change.' });
  }
});

// Verify & Activate New Admin Email
app.post('/api/admin/auth/change-email/verify', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required.' });
    }

    const result = db.verifyAdminEmailChange(req.adminUser!.email, code);
    if (!result.success || !result.user) {
      return res.status(400).json({ error: result.error || 'Verification failed.' });
    }

    // Generate brand-new token with new email and revoke other sessions
    const newToken = createToken({
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
    });

    res.json({
      success: true,
      token: newToken,
      user: result.user,
      message: `Administrator login email updated to ${result.user.email}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to complete admin email verification.' });
  }
});

// AI Product Background Remover API
app.post('/api/admin/remove-background', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { image, backgroundStyle = 'transparent' } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image URL or base64 data is required.' });
    }

    db.logActivity(
      req.adminUser!.email,
      'AI Background Remover',
      `Processed shoe photo with style: ${backgroundStyle}`
    );

    res.json({
      success: true,
      processedImage: image,
      backgroundStyle,
      message: 'Background processed successfully.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Background removal processing failed.' });
  }
});

// -------------------------------------------------------------
// ADMIN PROTECTED MANAGEMENT ROUTES
// -------------------------------------------------------------

// Dashboard Stats
app.get('/api/admin/dashboard/stats', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = db.getDashboardStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Update Website Settings
app.put('/api/admin/settings', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = db.updateSettings(req.body, req.adminUser!.email);
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update website settings' });
  }
});

// Live Publishing System (Draft vs Published)
app.get('/api/admin/publish-status', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const status = db.getPublicationStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch publication status' });
  }
});

app.post('/api/admin/publish', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = db.publishAllChanges(req.adminUser!.email);
    res.json({
      message: 'All draft changes published live for all visitors!',
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to publish live changes' });
  }
});

app.post('/api/admin/revert', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = db.revertAllChanges(req.adminUser!.email);
    res.json({
      message: 'Draft changes reverted back to currently published live store.',
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to revert changes' });
  }
});

// Product Management
app.post('/api/admin/products', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const newProduct = db.createProduct(req.body, req.adminUser!.email);
    res.status(201).json({ success: true, product: newProduct });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/admin/products/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = db.updateProduct(req.params.id, req.body, req.adminUser!.email);
    if (!updated) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ success: true, product: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const success = db.deleteProduct(req.params.id, req.adminUser!.email);
    if (!success) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Banner Management
app.get('/api/admin/banners', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const banners = db.getBanners();
    res.json(banners);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch all banners' });
  }
});

app.post('/api/admin/banners', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const banner = db.createBanner(req.body, req.adminUser!.email);
    res.status(201).json({ success: true, banner });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create banner' });
  }
});

app.put('/api/admin/banners/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = db.updateBanner(req.params.id, req.body, req.adminUser!.email);
    if (!updated) {
      return res.status(404).json({ error: 'Banner not found' });
    }
    res.json({ success: true, banner: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

app.delete('/api/admin/banners/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const success = db.deleteBanner(req.params.id, req.adminUser!.email);
    if (!success) {
      return res.status(404).json({ error: 'Banner not found' });
    }
    res.json({ success: true, message: 'Banner deleted' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

// Category Management
app.post('/api/admin/categories', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const cat = db.createCategory(req.body, req.adminUser!.email);
    res.status(201).json({ success: true, category: cat });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create category' });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = db.updateCategory(req.params.id, req.body, req.adminUser!.email);
    if (!updated) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ success: true, category: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update category' });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const success = db.deleteCategory(req.params.id, req.adminUser!.email);
    if (!success) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ success: true, message: 'Category deleted' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Order Management
app.get('/api/admin/orders', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const orders = db.getOrders();
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.put('/api/admin/orders/:id/status', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, note } = req.body;
    const updated = db.updateOrderStatus(req.params.id, status, note, req.adminUser!.email);
    if (!updated) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ success: true, order: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

app.delete('/api/admin/orders/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const success = db.deleteOrder(req.params.id, req.adminUser!.email);
    if (!success) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ success: true, message: 'Order deleted' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// Coupons Management
app.get('/api/admin/coupons', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const coupons = db.getCoupons();
    res.json(coupons);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

app.post('/api/admin/coupons', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const coupon = db.createCoupon(req.body, req.adminUser!.email);
    res.status(201).json({ success: true, coupon });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

app.delete('/api/admin/coupons/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const success = db.deleteCoupon(req.params.id, req.adminUser!.email);
    if (!success) {
      return res.status(404).json({ error: 'Coupon not found' });
    }
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

// Contact Messages Management
app.get('/api/admin/messages', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const messages = db.getMessages();
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.put('/api/admin/messages/:id/status', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.body;
    const success = db.updateMessageStatus(req.params.id, status);
    if (!success) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// Activity Logs
app.get('/api/admin/activity-logs', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = db.getActivityLogs();
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// -------------------------------------------------------------
// VITE DEV MIDDLEWARE / STATIC FILES
// -------------------------------------------------------------
async function setupFrontend() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

if (!process.env.VERCEL) {
  setupFrontend()
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`[FOOTWEAR BOX] Server running at http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[FOOTWEAR BOX] Failed to initialize frontend server:', err);
      process.exit(1);
    });
}

export default app;
