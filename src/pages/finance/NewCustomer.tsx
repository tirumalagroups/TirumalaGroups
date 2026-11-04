import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import { 
  ArrowLeft, 
  Save, 
  Camera, 
  Trash2 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { BiometricScanner } from '../../components/finance/BiometricScanner';
import { SignaturePad } from '../../components/finance/SignaturePad';
import { compressToWebP } from '../../utils/imageCompressor';
import { RELATIONSHIP_OPTIONS, parseRelationship, relationshipTypeForEdit } from '../../utils/relationship';

// Passport photo shape (3.5 x 4.5 cm)
const PHOTO_ASPECT = 35 / 45;

const NewCustomer: React.FC = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [estimatedId, setEstimatedId] = useState<number>(1);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const nameRef = useRef<HTMLInputElement>(null);
  const aadhaarRef = useRef<HTMLInputElement>(null);
  const aadhaarAddressRef = useRef<HTMLTextAreaElement>(null);
  const presentAddressRef = useRef<HTMLTextAreaElement>(null);
  const phone1Ref = useRef<HTMLInputElement>(null);

  // Form State
  const [aadhaar, setAadhaar] = useState('');
  const [name, setName] = useState('');
  const [relationshipType, setRelationshipType] = useState<string>('S/O');
  const [relationshipName, setRelationshipName] = useState('');
  const [aadhaarAddress, setAadhaarAddress] = useState('');
  const [presentAddress, setPresentAddress] = useState('');
  const [village, setVillage] = useState('');
  const [houseNo, setHouseNo] = useState('');
  const [mandal, setMandal] = useState('');
  const [district, setDistrict] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [originalPhotoUrl, setOriginalPhotoUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);

  // Fingerprint State
  const [fingerprintUrl, setFingerprintUrl] = useState<string | null>(null);
  const [fingerprintTemplate, setFingerprintTemplate] = useState<string | null>(null);
  const [fingerprintAdded, setFingerprintAdded] = useState(false);

  // Camera Capture State
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');

  useEffect(() => {
    if (editId) {
      loadCustomerDetails(editId);
    } else {
      fetchNextId();
    }
    return () => {
      stopCamera();
    };
  }, [editId]);

  const loadCustomerDetails = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('finance_customers')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (data) {
        setEstimatedId(data.customer_id || 1);
        setAadhaar(data.aadhaar || '');
        setName(data.name || '');
        const rawRel = data.father_name || data.father_husband_name || '';
        // Old "Father"/"Wife" records can't tell S/O vs D/O, so the user picks the relationship again
        setRelationshipType(relationshipTypeForEdit(rawRel));
        setRelationshipName(parseRelationship(rawRel).name);
        setAadhaarAddress(data.aadhaar_address || '');
        setPresentAddress(data.present_address || '');
        setVillage(data.present_village || data.village || '');
        setHouseNo(data.address || '');
        setMandal(data.mandal || data.present_mandal || data.aadhaar_mandal || '');
        setDistrict(data.district || data.present_district || data.aadhaar_district || '');
        setPhone1(data.phone_1 || data.phone || '');
        setPhone2(data.phone_2 || data.phone2 || '');
        setPhotoUrl(data.customer_photo_url || null);
        setOriginalPhotoUrl(data.customer_photo_url || null);
        setCapturedImage(data.customer_photo_url || null);
        setSignatureUrl(data.customer_fingerprint_image_url || null);
        setFingerprintUrl(data.fingerprint_url || null);
        setFingerprintTemplate(data.fingerprint_template || null);
        setFingerprintAdded(data.fingerprint_added || false);
      }
    } catch (err) {
      console.error('Error loading customer details:', err);
      toast.error('Failed to load customer details');
    }
  };

  const fetchNextId = async () => {
    try {
      const { data, error } = await supabase
        .from('finance_customers')
        .select('customer_id')
        .order('customer_id', { ascending: false })
        .limit(1);
      
      if (error) throw error;
      if (data && data.length > 0) {
        setEstimatedId((data[0].customer_id || 0) + 1);
      } else {
        setEstimatedId(1);
      }
    } catch (err) {
      console.error('Error fetching next Customer ID:', err);
    }
  };

  const startCamera = async () => {
    try {
      setCameraError(null);
      setCameraActive(true);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(e => console.error('Play error:', e));
        };
      }
    } catch (err: any) {
      console.error('Error accessing camera:', err);
      setCameraActive(false);
      let msg = 'Could not access camera';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission denied. Please allow camera access in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera device found on this device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'Camera is already in use by another application.';
      }
      setCameraError(msg);
      toast.error(msg);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;

    const srcW = video.videoWidth || 640;
    const srcH = video.videoHeight || 480;

    // Take the centre of the camera frame in passport-photo shape (same part the live box shows)
    let cropW = srcW;
    let cropH = Math.round(srcW / PHOTO_ASPECT);
    if (cropH > srcH) {
      cropH = srcH;
      cropW = Math.round(srcH * PHOTO_ASPECT);
    }
    const cropX = Math.round((srcW - cropW) / 2);
    const cropY = Math.round((srcH - cropH) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw un-mirrored for captured image
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    // Freeze image immediately in preview box
    setCapturedImage(dataUrl);
    stopCamera();

    // Trigger upload in background without discarding captured image if upload fails
    uploadCapturedDataUrl(dataUrl);
  };

  const ensureStorageBucket = async (bucketName: string) => {
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      if (buckets && !buckets.some(b => b.name === bucketName)) {
        console.log(`Bucket "${bucketName}" not found in list. Attempting creation...`);
        await supabase.storage.createBucket(bucketName, { public: true, fileSizeLimit: 10485760 });
      }
    } catch (e) {
      console.warn('Bucket existence check warning:', e);
    }
  };

  const uploadCapturedDataUrl = async (dataUrl: string) => {
    setSaving(true);
    setUploadError(null);
    try {
      const rawFile = dataURLtoFile(dataUrl, `cust_${Date.now()}.jpg`);
      const compressedBlob = await compressToWebP(rawFile, 1280, 0.8);
      const fileName = `cust_${Date.now()}_photo.webp`;

      console.log('--- STORAGE UPLOAD FORENSIC AUDIT (Photo) ---');
      console.log('[Upload Target Bucket]: finance-photos');
      console.log('[Generated Path]:', fileName);
      console.log('[Raw File Size]:', rawFile.size, 'bytes, type:', rawFile.type);
      console.log('[Compressed Blob Size]:', compressedBlob.size, 'bytes, type:', compressedBlob.type);

      await ensureStorageBucket('finance-photos');

      // Try uploading to finance-photos bucket, fallback to driver-license bucket
      let uploadRes = await supabase.storage
        .from('finance-photos')
        .upload(fileName, compressedBlob, { contentType: 'image/webp', upsert: true });

      let targetBucket = 'finance-photos';
      let targetPath = fileName;

      if (uploadRes.error) {
        console.warn('[finance-photos upload error]:', uploadRes.error?.message, 'Falling back to public bucket "driver-license"...');
        targetBucket = 'driver-license';
        targetPath = `customer_photos/${fileName}`;
        uploadRes = await supabase.storage
          .from('driver-license')
          .upload(targetPath, compressedBlob, { contentType: 'image/webp', upsert: true });
      }

      if (uploadRes.error) {
        console.error('[FINAL STORAGE ERROR]:', uploadRes.error);
        throw uploadRes.error;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(targetBucket)
        .getPublicUrl(targetPath);

      console.log('[Generated Public URL]:', publicUrl);

      setPhotoUrl(publicUrl);
      setCapturedImage(publicUrl);
      toast.success('Photo captured and stored permanently');
    } catch (err: any) {
      console.error('Photo upload failed:', err);
      const errMsg = err?.message || err?.error || JSON.stringify(err);
      setUploadError(`Upload failed: ${errMsg}`);
      toast.error(`Storage Upload Error: ${errMsg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRetryUpload = () => {
    if (capturedImage) {
      uploadCapturedDataUrl(capturedImage);
    }
  };

  const handleRetakePhoto = () => {
    setCapturedImage(null);
    setPhotoUrl(null);
    setUploadError(null);
    startCamera();
  };

  const handleCancelCamera = () => {
    stopCamera();
    setCameraError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid image type. Please select JPG, PNG, or WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds 5MB limit.');
      return;
    }

    // Immediate local preview
    const localPreviewUrl = URL.createObjectURL(file);
    setCapturedImage(localPreviewUrl);
    setUploadError(null);
    stopCamera();

    setSaving(true);
    try {
      const compressedBlob = await compressToWebP(file, 1280, 0.8);
      const fileName = `cust_${Date.now()}_photo.webp`;

      console.log('--- STORAGE UPLOAD FORENSIC AUDIT (Browse Photo) ---');
      console.log('[Browse File Name]:', file.name, 'Size:', file.size, 'Type:', file.type);
      console.log('[Compressed Blob Size]:', compressedBlob.size, 'bytes');

      await ensureStorageBucket('finance-photos');

      let uploadRes = await supabase.storage
        .from('finance-photos')
        .upload(fileName, compressedBlob, { contentType: 'image/webp', upsert: true });

      let targetBucket = 'finance-photos';
      let targetPath = fileName;

      if (uploadRes.error) {
        console.warn('[finance-photos upload error]:', uploadRes.error?.message, 'Falling back to public bucket "driver-license"...');
        targetBucket = 'driver-license';
        targetPath = `customer_photos/${fileName}`;
        uploadRes = await supabase.storage
          .from('driver-license')
          .upload(targetPath, compressedBlob, { contentType: 'image/webp', upsert: true });
      }

      if (uploadRes.error) {
        console.error('[FINAL BROWSE STORAGE ERROR]:', uploadRes.error);
        throw uploadRes.error;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(targetBucket)
        .getPublicUrl(targetPath);

      console.log('[Generated Public URL]:', publicUrl);

      setPhotoUrl(publicUrl);
      setCapturedImage(publicUrl);
      toast.success('Photo uploaded to storage');
    } catch (err: any) {
      console.error('Browse photo upload failed:', err);
      const errMsg = err?.message || err?.error || JSON.stringify(err);
      setUploadError(`Upload failed: ${errMsg}`);
      toast.error(`Storage Upload Error: ${errMsg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClearPhoto = () => {
    setPhotoUrl(null);
    setCapturedImage(null);
    setUploadError(null);
    setCameraError(null);
    stopCamera();
  };

  const dataURLtoFile = (dataurl: string, filename: string) => {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  const uploadSignature = async (signatureDataUrl: string | null) => {
    if (!signatureDataUrl) {
      setSignatureUrl(null);
      return;
    }
    setSaving(true);
    try {
      const fileName = `cust_${Date.now()}_sig.png`;
      const file = dataURLtoFile(signatureDataUrl, fileName);

      console.log('--- STORAGE UPLOAD FORENSIC AUDIT (Signature) ---');
      console.log('[Signature File Size]:', file.size, 'bytes, type:', file.type);
      console.log('[Generated Path]:', fileName);

      await ensureStorageBucket('finance-photos');

      let uploadRes = await supabase.storage
        .from('finance-photos')
        .upload(fileName, file, { contentType: 'image/png', upsert: true });

      let targetBucket = 'finance-photos';
      let targetPath = fileName;

      if (uploadRes.error) {
        console.warn('[finance-photos upload error for signature]:', uploadRes.error?.message, 'Falling back to public bucket "driver-license"...');
        targetBucket = 'driver-license';
        targetPath = `signatures/${fileName}`;
        uploadRes = await supabase.storage
          .from('driver-license')
          .upload(targetPath, file, { contentType: 'image/png', upsert: true });
      }

      if (uploadRes.error) {
        console.error('[FINAL SIGNATURE STORAGE ERROR]:', uploadRes.error);
        throw uploadRes.error;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(targetBucket)
        .getPublicUrl(targetPath);

      console.log('[Signature Public URL]:', publicUrl);

      setSignatureUrl(publicUrl);
      toast.success('Signature uploaded to storage');
    } catch (err: any) {
      console.error('Signature upload failed:', err);
      const errMsg = err?.message || err?.error || JSON.stringify(err);
      toast.error(`Signature Upload Error: ${errMsg}`);
      setSignatureUrl(null);
    } finally {
      setSaving(false);
    }
  };

  const handleResetForm = () => {
    setAadhaar('');
    setName('');
    setRelationshipType('S/O');
    setRelationshipName('');
    setAadhaarAddress('');
    setPresentAddress('');
    setVillage('');
    setHouseNo('');
    setMandal('');
    setDistrict('');
    setPhone1('');
    setPhone2('');
    handleClearPhoto();
    setSignatureUrl(null);
    setFingerprintUrl(null);
    setFingerprintTemplate(null);
    setFingerprintAdded(false);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (saving) return;

    // Validate 10 Mandatory fields required by business logic
    const validationErrors: Record<string, boolean> = {};

    if (!name.trim()) validationErrors.name = true;
    if (!relationshipType) validationErrors.relationshipType = true;
    if (!relationshipName.trim()) validationErrors.relationshipName = true;
    if (!village.trim()) validationErrors.village = true;
    if (!phone1.trim()) validationErrors.phone1 = true;
    if (!aadhaar.trim()) validationErrors.aadhaar = true;
    if (!aadhaarAddress.trim()) validationErrors.aadhaarAddress = true;
    if (!presentAddress.trim()) validationErrors.presentAddress = true;
    if (!houseNo.trim()) validationErrors.houseNo = true;
    if (!mandal.trim()) validationErrors.mandal = true;
    if (!district.trim()) validationErrors.district = true;

    const cleanAadhaar = aadhaar.replace(/\s+/g, '');
    if (cleanAadhaar && !/^\d{12}$/.test(cleanAadhaar)) {
      validationErrors.aadhaar = true;
      toast.error('Aadhaar UID must be exactly 12 digits');
    }

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      toast.error('Please complete all mandatory fields marked with *');
      if (validationErrors.name) nameRef.current?.focus();
      else if (validationErrors.phone1) phone1Ref.current?.focus();
      else if (validationErrors.aadhaar) aadhaarRef.current?.focus();
      else if (validationErrors.aadhaarAddress) aadhaarAddressRef.current?.focus();
      else if (validationErrors.presentAddress) presentAddressRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      if (!editId && cleanAadhaar) {
        const query = supabase.from('finance_customers').select('id, name, customer_id').eq('aadhaar', cleanAadhaar);
        const { data: existingCustomers } = await query.limit(1);

        if (existingCustomers && existingCustomers.length > 0) {
          const dup = existingCustomers[0];
          toast.error(`Customer with this Aadhaar already exists (Name: ${dup.name}, ID: ${dup.customer_id || 'N/A'}).`);
          setSaving(false);
          return;
        }
      }

      const payload = {
        name: name.trim(),
        phone: phone1.trim() || null,
        phone2: phone2.trim() || null,
        partner_name: null,
        address: houseNo.trim() || null,
        aadhaar: cleanAadhaar || null,
        customer_photo_url: photoUrl || null,
        father_husband_name: `${relationshipType}:${relationshipName.trim()}`,
        father_name: `${relationshipType}:${relationshipName.trim()}`,
        aadhaar_address: aadhaarAddress.trim() || null,
        present_address: presentAddress.trim() || null,
        village: village.trim() || null,
        present_village: village.trim() || null,
        mandal: mandal.trim() || null,
        present_mandal: mandal.trim() || null,
        district: district.trim() || null,
        present_district: district.trim() || null,
        phone_1: phone1.trim() || null,
        phone_2: phone2.trim() || null,
        customer_fingerprint_image_url: signatureUrl || null,
        customer_fingerprint_template: null,
        customer_fingerprint_added: false,
        fingerprint_url: fingerprintUrl || null,
        fingerprint_template: fingerprintTemplate || null,
        fingerprint_added: fingerprintAdded
      };

      let result;
      if (editId) {
        const staffName = sessionStorage.getItem('thirumala_user') 
          ? JSON.parse(sessionStorage.getItem('thirumala_user')!).username 
          : 'Staff';
        result = await supabaseFinance.updateCustomer(editId, payload, staffName);
      } else {
        result = await supabaseFinance.createCustomer(payload);
      }

      if (result) {
        toast.success(editId ? 'Customer details updated successfully.' : 'Customer registered successfully.');

        // ATOMIC STORAGE CLEANUP: Safely remove old photo object ONLY AFTER successful DB commit
        if (editId && originalPhotoUrl && photoUrl && originalPhotoUrl !== photoUrl) {
          cleanupOldStoragePhoto(originalPhotoUrl);
        }

        // Notify active sessions and screens to invalidate and refresh customer photo cache
        if (editId && photoUrl) {
          window.dispatchEvent(new CustomEvent('customer_photo_updated', {
            detail: { customerId: editId, photoUrl }
          }));
        }

        if (!editId) {
          handleResetForm();
          fetchNextId();
        } else {
          navigate('/finance/customers');
        }
      } else {
        toast.error('Failed to save customer');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error processing request');
    } finally {
      setSaving(false);
    }
  };

  const cleanupOldStoragePhoto = async (oldUrl: string) => {
    try {
      console.log('[Storage Cleanup] Attempting deletion of superseded photo:', oldUrl);
      let bucket = 'finance-photos';
      let path = '';

      if (oldUrl.includes('/storage/v1/object/public/')) {
        const urlParts = oldUrl.split('/storage/v1/object/public/')[1];
        const slashIdx = urlParts.indexOf('/');
        if (slashIdx !== -1) {
          bucket = urlParts.substring(0, slashIdx);
          path = urlParts.substring(slashIdx + 1);
        }
      } else {
        path = oldUrl.substring(oldUrl.lastIndexOf('/') + 1);
      }

      if (bucket && path) {
        const { error } = await supabase.storage.from(bucket).remove([path]);
        if (error) {
          console.warn('[Storage Cleanup Warning] Could not remove old image object:', error.message);
        } else {
          console.log('[Storage Cleanup Success] Deleted old storage object:', path, 'from bucket:', bucket);
        }
      }
    } catch (cleanErr) {
      console.warn('[Storage Cleanup Warning] Failed to clean up old image:', cleanErr);
    }
  };

  return (
    <div className="space-y-3 w-full select-none font-outfit text-slate-800 p-2">
      
      {/* Top Action Header */}
      <div className="flex justify-between items-center bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
        <div>
          <div className="flex items-center gap-3 leading-none">
            <h1 className="text-[24px] font-bold uppercase text-slate-900 tracking-tight leading-none">
              {editId ? `EDIT CUSTOMER` : `NEW CUSTOMER REGISTRATION`}
            </h1>
            {!editId && estimatedId && (
              <span className="inline-flex items-center px-2.5 py-1 rounded bg-slate-900 text-white font-mono font-black text-[13px] tracking-wider leading-none">
                NEXT ID: #{estimatedId}
              </span>
            )}
          </div>
          <p className="text-[14px] text-slate-400 font-bold uppercase mt-1">
            Demographic, photograph, signature and biometrics
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => navigate(editId ? '/finance/customers' : '/finance')}
            className="inline-flex items-center justify-center gap-1 px-3 h-[48px] bg-white text-slate-700 border border-slate-250 rounded hover:bg-slate-50 font-bold text-[16px] uppercase"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            type="button"
            onClick={handleResetForm}
            className="inline-flex items-center justify-center gap-1 px-3 h-[48px] bg-white text-red-700 border border-slate-250 rounded hover:bg-red-50 font-bold text-[16px] uppercase"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1 px-4 h-[48px] bg-[#0b1329] text-white border border-slate-800 rounded hover:bg-slate-800 font-bold text-[16px] uppercase disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Main Form Fields */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-3">
          
          {/* Row 1 Grid */}
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-12 md:col-span-3">
              <label className="uppercase block mb-1 text-[15px] font-bold text-slate-700">
                Customer Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                ref={nameRef}
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors(p => ({...p, name: false})) }}
                placeholder="Full Name"
                className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold ${errors.name ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
              />
              {errors.name && <p className="text-xs text-red-500 font-bold mt-1">Customer Name is required</p>}
            </div>
            
            <div className="col-span-4 md:col-span-2">
              <label className="uppercase block mb-1 text-[15px] font-bold text-slate-700">
                Relationship <span className="text-red-500">*</span>
              </label>
              <select
                value={relationshipType}
                onChange={(e) => { setRelationshipType(e.target.value); setErrors(p => ({...p, relationshipType: false})) }}
                className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold ${errors.relationshipType ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
              >
                {!relationshipType && <option value="">Select</option>}
                {RELATIONSHIP_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {errors.relationshipType && <p className="text-xs text-red-500 font-bold mt-1">Select the relationship</p>}
            </div>

            <div className="col-span-8 md:col-span-4">
              <label className="uppercase block mb-1 text-[15px] font-bold text-slate-700">
                Relationship Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={relationshipName}
                onChange={(e) => { setRelationshipName(e.target.value); setErrors(p => ({...p, relationshipName: false})) }}
                placeholder="Father / Husband / Son's Name"
                className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold uppercase ${errors.relationshipName ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
              />
              {errors.relationshipName && <p className="text-xs text-red-500 font-bold mt-1">Relationship Name is required</p>}
            </div>

            <div className="col-span-12 md:col-span-3">
              <label className="uppercase block mb-1 text-[15px] font-bold text-slate-700 font-mono">
                Aadhaar (12-digit) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                ref={aadhaarRef}
                value={aadhaar}
                onChange={(e) => { setAadhaar(e.target.value); setErrors(p => ({...p, aadhaar: false})) }}
                placeholder="12-digit Aadhaar UID"
                className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold ${errors.aadhaar ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
              />
              {errors.aadhaar && <p className="text-xs text-red-500 font-bold mt-1">12-digit Aadhaar is required</p>}
            </div>
          </div>

          {/* Row 2 Grid */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 md:col-span-6">
              <label className="uppercase block mb-1 text-[15px] font-bold text-slate-700">
                Phone 1 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                ref={phone1Ref}
                value={phone1}
                onChange={(e) => { setPhone1(e.target.value); setErrors(p => ({...p, phone1: false})) }}
                placeholder="Primary Contact"
                className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold ${errors.phone1 ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
              />
              {errors.phone1 && <p className="text-xs text-red-500 font-bold mt-1">Phone 1 is required</p>}
            </div>
            <div className="col-span-12 md:col-span-6">
              <label className="uppercase block mb-1 text-[15px] font-bold text-slate-700">Phone 2</label>
              <input
                type="text"
                value={phone2}
                onChange={(e) => setPhone2(e.target.value)}
                placeholder="Secondary Contact"
                className="w-full bg-white border border-slate-250 rounded px-3 text-[16px] text-slate-850 focus:ring-1 focus:ring-slate-900 focus:outline-none h-[48px] font-bold"
              />
            </div>
          </div>

          {/* Row 3 Grid */}
          <div className="grid grid-cols-12 gap-3 border-t border-slate-100 pt-3">
            <div className="col-span-12 md:col-span-4 flex flex-col">
              <label className="block text-[15px] font-bold text-slate-700 uppercase mb-1">
                Aadhaar Address <span className="text-red-500">*</span>
              </label>
              <textarea
                ref={aadhaarAddressRef}
                value={aadhaarAddress}
                onChange={(e) => { setAadhaarAddress(e.target.value); setErrors(p => ({...p, aadhaarAddress: false})) }}
                placeholder="Aadhaar Address (Door No, Street, Village, Mandal, District)"
                rows={3}
                className={`w-full flex-1 bg-white border rounded p-2 text-[16px] text-slate-800 focus:outline-none resize-none font-bold ${errors.aadhaarAddress ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
              />
              {errors.aadhaarAddress && <p className="text-xs text-red-500 font-bold mt-1">Aadhaar Address is required</p>}
            </div>
            
            <div className="col-span-12 md:col-span-4 flex flex-col">
              <label className="block text-[15px] font-bold text-slate-700 uppercase mb-1">
                Present Address <span className="text-red-500">*</span>
              </label>
              <textarea
                ref={presentAddressRef}
                value={presentAddress}
                onChange={(e) => { setPresentAddress(e.target.value); setErrors(p => ({...p, presentAddress: false})) }}
                placeholder="Street / Area / Landmark"
                rows={3}
                className={`w-full flex-1 bg-white border rounded p-2 text-[16px] text-slate-850 focus:outline-none resize-none font-bold ${errors.presentAddress ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
              />
              {errors.presentAddress && <p className="text-xs text-red-500 font-bold mt-1">Present Address is required</p>}
            </div>

            <div className="col-span-12 md:col-span-4 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[15px] font-bold text-slate-700 uppercase mb-1">
                  House No <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={houseNo}
                  onChange={(e) => { setHouseNo(e.target.value); setErrors(p => ({...p, houseNo: false})) }}
                  placeholder="Door No"
                  className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold uppercase ${errors.houseNo ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
                />
                {errors.houseNo && <p className="text-xs text-red-500 font-bold mt-1">House No is required</p>}
              </div>
              <div>
                <label className="block text-[15px] font-bold text-slate-700 uppercase mb-1">
                  Village <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={village}
                  onChange={(e) => { setVillage(e.target.value); setErrors(p => ({...p, village: false})) }}
                  placeholder="Village"
                  className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold uppercase ${errors.village ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
                />
                {errors.village && <p className="text-xs text-red-500 font-bold mt-1">Village is required</p>}
              </div>
              <div>
                <label className="block text-[15px] font-bold text-slate-700 uppercase mb-1">
                  Mandal <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={mandal}
                  onChange={(e) => { setMandal(e.target.value); setErrors(p => ({...p, mandal: false})) }}
                  placeholder="Mandal"
                  className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold uppercase ${errors.mandal ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
                />
                {errors.mandal && <p className="text-xs text-red-500 font-bold mt-1">Mandal is required</p>}
              </div>
              <div>
                <label className="block text-[15px] font-bold text-slate-700 uppercase mb-1">
                  District <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={district}
                  onChange={(e) => { setDistrict(e.target.value); setErrors(p => ({...p, district: false})) }}
                  placeholder="District"
                  className={`w-full bg-white border rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold uppercase ${errors.district ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-250 focus:ring-1 focus:ring-slate-900'}`}
                />
                {errors.district && <p className="text-xs text-red-500 font-bold mt-1">District is required</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Compressed Row: Photograph, Signature, Fingerprint */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          
          {/* Card 1: Photo Capture */}
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col items-center space-y-2 shadow-sm">
            <div className="flex items-center justify-between w-full">
              <span className="text-[15px] font-bold text-slate-700 uppercase">Customer Photograph</span>
              {cameraActive && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold uppercase animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600"></span> Live
                </span>
              )}
            </div>

            {/* Passport-photo shaped box; an uploaded photo is shown in full (never cropped) */}
            <div className="h-44 aspect-[35/45] bg-slate-100 rounded border border-slate-300 flex items-center justify-center overflow-hidden relative shadow-inner">
              {cameraActive ? (
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover transform -scale-x-100 bg-slate-900"
                  autoPlay
                  playsInline
                  muted
                />
              ) : capturedImage ? (
                <img src={capturedImage} alt="Captured Profile" className="w-full h-full object-contain" />
              ) : cameraError ? (
                <div className="text-center p-2 text-red-600 text-xs font-semibold">
                  <p>{cameraError}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center text-slate-400">
                  <Camera className="w-8 h-8 mb-1 stroke-1 text-slate-500" />
                  <span className="text-[12px] font-bold uppercase">No Capture</span>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="w-full flex items-center justify-between text-[11px] bg-red-50 border border-red-200 text-red-700 px-2 py-1 rounded font-bold">
                <span>Upload Failed</span>
                <button
                  type="button"
                  onClick={handleRetryUpload}
                  className="bg-red-600 text-white px-2 py-0.5 rounded text-[10px] uppercase font-bold hover:bg-red-700"
                >
                  Retry Upload
                </button>
              </div>
            )}

            <div className="flex gap-1.5 w-full">
              {cameraActive ? (
                <>
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="flex-grow h-[38px] bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[14px] font-bold uppercase transition-colors shadow-sm"
                  >
                    Capture
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelCamera}
                    className="h-[38px] px-3 bg-slate-100 text-slate-700 border border-slate-300 rounded text-[14px] font-bold uppercase hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                </>
              ) : capturedImage ? (
                <>
                  <button
                    type="button"
                    onClick={handleRetakePhoto}
                    className="flex-grow h-[38px] bg-white text-slate-700 border border-slate-300 rounded text-[14px] font-bold uppercase hover:bg-slate-50 shadow-sm"
                  >
                    Retake
                  </button>
                  <label className="h-[38px] px-3 bg-white text-slate-700 border border-slate-300 rounded text-[14px] font-bold uppercase cursor-pointer hover:bg-slate-50 flex items-center justify-center shadow-sm">
                    Browse
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleClearPhoto}
                    className="px-2.5 h-[38px] bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 flex items-center justify-center"
                    title="Remove Photo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex-grow h-[38px] bg-slate-900 text-white border border-slate-800 rounded text-[14px] font-bold uppercase inline-flex items-center justify-center gap-1.5 hover:bg-slate-800 shadow-sm"
                  >
                    <Camera className="w-4 h-4" />
                    Camera
                  </button>
                  <label className="h-[38px] px-3 bg-white text-slate-700 border border-slate-300 rounded text-[14px] font-bold uppercase cursor-pointer hover:bg-slate-50 flex items-center justify-center shadow-sm">
                    Browse
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                </>
              )}
            </div>
            <canvas ref={canvasRef} width={640} height={480} className="hidden" />
          </div>

          {/* Card 2: Signature Pad */}
          <SignaturePad
            existingUrl={signatureUrl}
            onSave={uploadSignature}
          />

          {/* Card 3: Fingerprint Biometric */}
          <BiometricScanner
            label="Fingerprint Biometric"
            existingTemplate={fingerprintTemplate}
            existingImageUrl={fingerprintUrl}
            onFingerprintSaved={(url, template, added) => {
              setFingerprintUrl(url);
              setFingerprintTemplate(template);
              setFingerprintAdded(added);
            }}
          />
        </div>
      </form>
    </div>
  );
};

export default NewCustomer;
