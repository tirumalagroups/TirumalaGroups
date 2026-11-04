import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Select from '../components/UI/Select';
import { useTableMode } from '../contexts/TableModeContext';
import toast from 'react-hot-toast';
import ModeLabel from '../components/UI/ModeLabel';
import { format, differenceInDays } from 'date-fns';
import { supabaseDB } from '../lib/supabaseDatabase';
import { Vehicle } from '../lib/supabaseDatabase';
import { supabase } from '../lib/supabase';
import { useBook } from '../contexts/BookContext';
import {
  X,
  Truck,
  AlertTriangle,
  Edit,
  Clock,
  CheckCircle,
  Search,
} from 'lucide-react';

const Vehicles: React.FC = () => {
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const highlightExpiring = queryParams.get('highlightExpiring') === 'true' || location.state?.highlightExpiring;

  const [isHighlightActive, setIsHighlightActive] = useState(false);

  useEffect(() => {
    if (highlightExpiring && vehicles.length > 0) {
      setIsHighlightActive(true);
      const timer = setTimeout(() => {
        setIsHighlightActive(false);
      }, 5000); // 5 seconds highlight

      const scrollTimer = setTimeout(() => {
        const firstExpiringVehicle = vehicles.find(v => hasExpiredDocuments(v) || hasExpiringDocuments(v));
        if (firstExpiringVehicle) {
          const element = document.getElementById(`vehicle-row-${firstExpiringVehicle.id}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        clearTimeout(scrollTimer);
      };
    }
  }, [vehicles, highlightExpiring]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [rcFrontFile, setRcFrontFile] = useState<File | null>(null);
  const [rcBackFile, setRcBackFile] = useState<File | null>(null);

  // Filters
  const [filters, setFilters] = useState({
    vehicleType: '',
    expiryStatus: '',
    dateRange: '',
  });

  // Vehicle state according to schema
  const [newVehicle, setNewVehicle] = useState({
    v_no: '',
    v_type: '',
    particulars: '',
    tax_exp_date: '',
    insurance_exp_date: '',
    fitness_exp_date: '',
    permit_exp_date: '',
  });

  // Summary stats
  const [stats, setStats] = useState({
    totalVehicles: 0,
    expiredDocuments: 0,
    expiringDocuments: 0,
    validDocuments: 0,
  });

  useEffect(() => {
    loadVehicles();
  }, [tableMode, currentBook?.id]);

  useEffect(() => {
    applyFilters();
    updateStats();
  }, [vehicles, searchTerm, filters]);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const vehiclesData = await supabaseDB.getVehicles();
      setVehicles(vehiclesData);
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast.error('Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...vehicles];

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        vehicle =>
          (vehicle.v_no || '')
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          (vehicle.v_type || '')
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          (vehicle.particulars || '')
            .toLowerCase()
            .includes(searchTerm.toLowerCase())
      );
    }

    // Vehicle type filter
    if (filters.vehicleType) {
      filtered = filtered.filter(
        vehicle => vehicle.v_type === filters.vehicleType
      );
    }

    // Expiry status filter
    if (filters.expiryStatus) {
      filtered = filtered.filter(vehicle => {
        const hasExpiredDoc = hasExpiredDocuments(vehicle);
        const hasExpiringDoc = hasExpiringDocuments(vehicle);

        switch (filters.expiryStatus) {
          case 'expired':
            return hasExpiredDoc;
          case 'expiring':
            return hasExpiringDoc && !hasExpiredDoc;
          case 'valid':
            return !hasExpiredDoc && !hasExpiringDoc;
          default:
            return true;
        }
      });
    }

    // If highlightExpiring is true, sort expiring/expired to the top
    if (highlightExpiring) {
      filtered.sort((a, b) => {
        const aExp = hasExpiredDocuments(a) || hasExpiringDocuments(a);
        const bExp = hasExpiredDocuments(b) || hasExpiringDocuments(b);
        if (aExp && !bExp) return -1;
        if (!aExp && bExp) return 1;
        return 0;
      });
    }

    setFilteredVehicles(filtered);
  };

  const updateStats = () => {
    const totalVehicles = vehicles.length;
    let expiredDocuments = 0;
    let expiringDocuments = 0;
    let validDocuments = 0;

    vehicles.forEach(vehicle => {
      if (hasExpiredDocuments(vehicle)) {
        expiredDocuments++;
      } else if (hasExpiringDocuments(vehicle)) {
        expiringDocuments++;
      } else {
        validDocuments++;
      }
    });

    setStats({
      totalVehicles,
      expiredDocuments,
      expiringDocuments,
      validDocuments,
    });
  };

  const getExpiryStatus = (expiryDate: string | null | undefined) => {
    if (!expiryDate) {
      return { status: 'valid', color: 'bg-green-500 text-white', days: 999 };
    }

    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = differenceInDays(expiry, today);

    if (daysUntilExpiry < 0) {
      return {
        status: 'expired',
        color: 'bg-red-500 text-white',
        days: Math.abs(daysUntilExpiry),
      };
    } else if (daysUntilExpiry <= 30) {
      return {
        status: 'expiring',
        color: 'bg-orange-500 text-white',
        days: daysUntilExpiry,
      };
    } else {
      return {
        status: 'valid',
        color: 'bg-green-500 text-white',
        days: daysUntilExpiry,
      };
    }
  };

  const hasExpiredDocuments = (vehicle: Vehicle) => {
    const dates = [
      vehicle.tax_exp_date,
      vehicle.insurance_exp_date,
      vehicle.fitness_exp_date,
      vehicle.permit_exp_date,
    ];
    return dates.some(
      date => date && getExpiryStatus(date).status === 'expired'
    );
  };

  const hasExpiringDocuments = (vehicle: Vehicle) => {
    const dates = [
      vehicle.tax_exp_date,
      vehicle.insurance_exp_date,
      vehicle.fitness_exp_date,
      vehicle.permit_exp_date,
    ];
    return dates.some(
      date => date && getExpiryStatus(date).status === 'expiring'
    );
  };

  const handleInputChange = (field: string, value: string) => {
    if (editingVehicle) {
      setEditingVehicle({ ...editingVehicle, [field]: value });
    } else {
      setNewVehicle({ ...newVehicle, [field]: value });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    setLoading(true);

    try {
      if (editingVehicle) {
        // Update existing vehicle
        const updatedVehicle = await supabaseDB.updateVehicle(
          editingVehicle.id,
          editingVehicle
        );
        if (updatedVehicle) {
          await loadVehicles();
          setEditingVehicle(null);
          toast.success('Vehicle updated successfully!');
        } else {
          toast.error('Failed to update vehicle');
        }
      } else {
        // Add new vehicle
        let rcFrontUrl = '';
        let rcBackUrl = '';
        // Upload RC Front Photo
        if (rcFrontFile) {
          const { data, error } = await supabase.storage
            .from('vehicle-rc')
            .upload(`rc-front-${Date.now()}-${rcFrontFile.name}`, rcFrontFile);
          console.log('RC Front Upload:', data, error); // Debug log
          if (error) throw error;
          rcFrontUrl = supabase.storage
            .from('vehicle-rc')
            .getPublicUrl(data.path).data.publicUrl;
          console.log('RC Front URL:', rcFrontUrl); // Debug log
        }
        // Upload RC Back Photo
        if (rcBackFile) {
          const { data, error } = await supabase.storage
            .from('vehicle-rc')
            .upload(`rc-back-${Date.now()}-${rcBackFile.name}`, rcBackFile);
          console.log('RC Back Upload:', data, error); // Debug log
          if (error) throw error;
          rcBackUrl = supabase.storage
            .from('vehicle-rc')
            .getPublicUrl(data.path).data.publicUrl;
          console.log('RC Back URL:', rcBackUrl); // Debug log
        }
        const vehicleInsertObj = {
          sno: vehicles.length + 1,
          v_no: newVehicle.v_no,
          v_type: newVehicle.v_type || '',
          particulars: newVehicle.particulars || '',
          tax_exp_date: newVehicle.tax_exp_date || '',
          insurance_exp_date: newVehicle.insurance_exp_date || '',
          fitness_exp_date: newVehicle.fitness_exp_date || '',
          permit_exp_date: newVehicle.permit_exp_date || '',
          rc_front_url: rcFrontUrl,
          rc_back_url: rcBackUrl,
          date_added: new Date().toISOString(),
        };
        console.log('Vehicle Insert Object:', vehicleInsertObj); // Debug log
        const newVehicleData = await supabaseDB.addVehicle(vehicleInsertObj);
        if (newVehicleData) {
          await loadVehicles();
          setNewVehicle({
            v_no: '',
            v_type: '',
            particulars: '',
            tax_exp_date: '',
            insurance_exp_date: '',
            fitness_exp_date: '',
            permit_exp_date: '',
          });
          setShowAddForm(false);
          toast.success('Vehicle added successfully!');
        } else {
          toast.error('Failed to add vehicle');
        }
      }
    } catch (error) {
      console.error('Error saving vehicle:', error);
      toast.error(
        'Failed to save vehicle: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (vehicle: Vehicle) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    setEditingVehicle({ ...vehicle });
    setShowAddForm(false);
  };

  const handleDelete = async (vehicleId: string) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this vehicle?')) {
      setLoading(true);
      try {
        const success = await supabaseDB.deleteVehicle(vehicleId);
        if (success) {
          toast.success('Vehicle deleted successfully!');
          await loadVehicles();
        } else {
          toast.error('Failed to delete vehicle');
        }
      } catch (error) {
        console.error('Error deleting vehicle:', error);
        toast.error('Error deleting vehicle');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleViewDetails = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setShowDetails(true);
  };

  const vehicleTypeOptions = [
    { value: '', label: 'All Types' },
    ...Array.from(new Set(vehicles.map(v => v.v_type).filter(Boolean))).map(
      type => ({
        value: type as string,
        label: type as string,
      })
    ),
  ];

  const expiryStatusOptions = [
    { value: '', label: 'All Status' },
    { value: 'expired', label: 'Expired' },
    { value: 'expiring', label: 'Expiring Soon' },
    { value: 'valid', label: 'Valid' },
  ];

  const [imageModal, setImageModal] = useState<{
    url: string;
    label: string;
  } | null>(null);

  return (
    <div className='min-h-screen flex flex-col'>
      {/* Locked Book Banner */}
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm flex items-center gap-3 no-print mb-6">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 animate-pulse" />
          <div>
            <h3 className="text-sm font-bold text-red-800">This Book Is Locked (Read Only)</h3>
            <p className="text-xs text-red-700">Writing, editing, and deletion operations are disabled for this accounting period.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <div className='flex items-center gap-3 mb-1'>
            <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2.5'>
              Vehicles Management
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                currentBook?.is_locked 
                  ? 'bg-red-100 text-red-700' 
                  : tableMode === 'itr' 
                    ? 'bg-emerald-100 text-emerald-700' 
                    : 'bg-blue-100 text-blue-700'
              }`}>
                {tableMode === 'itr' ? 'ITR Mode' : 'Regular Mode'} | {currentBook?.book_code || 'No Book'}
              </span>
            </h1>
            <ModeLabel />
          </div>
          <p className='text-gray-600'>
            Comprehensive vehicle tracking with expiry management
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <Button variant='secondary' onClick={loadVehicles}>
            Refresh
          </Button>
          {!currentBook?.is_locked && (
            <Button
              onClick={() => {
                setShowAddForm(!showAddForm);
                setEditingVehicle(null);
              }}
            >
              Add Vehicle
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
        <Card className='bg-gradient-to-r from-blue-500 to-blue-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-blue-100 text-sm font-medium'>
                Total Vehicles
              </p>
              <p className='text-2xl font-bold'>{stats.totalVehicles}</p>
            </div>
            <Truck className='w-8 h-8 text-blue-200' />
          </div>
        </Card>

        <Card className='bg-gradient-to-r from-red-500 to-red-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-red-100 text-sm font-medium'>
                Expired Documents
              </p>
              <p className='text-2xl font-bold'>{stats.expiredDocuments}</p>
            </div>
            <AlertTriangle className='w-8 h-8 text-red-200' />
          </div>
        </Card>

        <Card className='bg-gradient-to-r from-orange-500 to-orange-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-orange-100 text-sm font-medium'>
                Expiring Soon
              </p>
              <p className='text-2xl font-bold'>{stats.expiringDocuments}</p>
            </div>
            <Clock className='w-8 h-8 text-orange-200' />
          </div>
        </Card>

        <Card className='bg-gradient-to-r from-green-500 to-green-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-green-100 text-sm font-medium'>
                Valid Documents
              </p>
              <p className='text-2xl font-bold'>{stats.validDocuments}</p>
            </div>
            <CheckCircle className='w-8 h-8 text-green-200' />
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className='bg-gradient-to-r from-gray-50 to-blue-50 border-gray-200'>
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          <Select
            label='Vehicle Type'
            value={filters.vehicleType}
            onChange={value =>
              setFilters(prev => ({ ...prev, vehicleType: value }))
            }
            options={vehicleTypeOptions}
          />

          <Select
            label='Expiry Status'
            value={filters.expiryStatus}
            onChange={value =>
              setFilters(prev => ({ ...prev, expiryStatus: value }))
            }
            options={expiryStatusOptions}
          />

          <div className='flex items-end'>
            <div className='text-sm text-gray-600 bg-white px-3 py-2 rounded-lg border border-gray-300 w-full text-center'>
              <strong>{filteredVehicles.length}</strong> vehicles found
            </div>
          </div>

          <div className='flex flex-col justify-end'>
            <label
              htmlFor='vehicle-search'
              className='text-sm font-medium text-gray-700 mb-1'
            >
              Search
            </label>
            <div className='relative'>
              <Search className='w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400' />
              <input
                id='vehicle-search'
                type='text'
                placeholder='Search vehicles...'
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className='pl-10 pr-4 h-12 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base'
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Add/Edit Vehicle Form */}
      {(showAddForm || editingVehicle) && (
        <Card
          title={
            <div className='flex items-center gap-3'>
              <span>{editingVehicle ? 'Edit Vehicle' : 'New Vehicle Entry Form'}</span>
              {(() => {
                const count = vehicles.filter(v => hasExpiringDocuments(v)).length;
                return count > 0 ? (
                  <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-300'>
                    <AlertTriangle className='w-3 h-3' />
                    Vehicle expiry due: {count}
                  </span>
                ) : null;
              })()}
            </div>
          }
        >
          <form onSubmit={handleSubmit} className='space-y-4'>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
              <Input
                label='Vehicle Number'
                value={editingVehicle ? editingVehicle.v_no : newVehicle.v_no}
                onChange={value => handleInputChange('v_no', value)}
                placeholder='AP23AB1234'
                required
              />
              <Input
                label='Type'
                value={
                  editingVehicle
                    ? editingVehicle.v_type || ''
                    : newVehicle.v_type
                }
                onChange={value => handleInputChange('v_type', value)}
                placeholder='Truck/Car/Bus...'
              />
              <Input
                label='Particulars'
                value={
                  editingVehicle
                    ? editingVehicle.particulars || ''
                    : newVehicle.particulars
                }
                onChange={value => handleInputChange('particulars', value)}
                placeholder='Description...'
              />
            </div>
            <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
              <Input
                label='Tax Expiry Date'
                type='date'
                value={
                  editingVehicle
                    ? editingVehicle.tax_exp_date || ''
                    : newVehicle.tax_exp_date
                }
                onChange={value => handleInputChange('tax_exp_date', value)}
              />
              <Input
                label='Insurance Expiry Date'
                type='date'
                value={
                  editingVehicle
                    ? editingVehicle.insurance_exp_date || ''
                    : newVehicle.insurance_exp_date
                }
                onChange={value =>
                  handleInputChange('insurance_exp_date', value)
                }
              />
              <Input
                label='Fitness Expiry Date'
                type='date'
                value={
                  editingVehicle
                    ? editingVehicle.fitness_exp_date || ''
                    : newVehicle.fitness_exp_date
                }
                onChange={value => handleInputChange('fitness_exp_date', value)}
              />
              <Input
                label='Permit Expiry Date'
                type='date'
                value={
                  editingVehicle
                    ? editingVehicle.permit_exp_date || ''
                    : newVehicle.permit_exp_date
                }
                onChange={value => handleInputChange('permit_exp_date', value)}
              />
            </div>
            <div className='mb-4'>
              <label className='block text-sm font-medium text-gray-700 mb-1'>
                RC Front Photo
              </label>
              <input
                type='file'
                accept='image/*'
                onChange={e =>
                  setRcFrontFile(
                    e.target.files && e.target.files[0]
                      ? e.target.files[0]
                      : null
                  )
                }
                className='block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100'
              />
            </div>
            <div className='mb-4'>
              <label className='block text-sm font-medium text-gray-700 mb-1'>
                RC Back Photo
              </label>
              <input
                type='file'
                accept='image/*'
                onChange={e =>
                  setRcBackFile(
                    e.target.files && e.target.files[0]
                      ? e.target.files[0]
                      : null
                  )
                }
                className='block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100'
              />
            </div>
            <div className='flex gap-4'>
              <Button type='submit' disabled={loading}>
                {loading ? 'Saving...' : editingVehicle ? 'Update' : 'Add'}
              </Button>
              <Button
                type='button'
                variant='secondary'
                onClick={() => {
                  setShowAddForm(false);
                  setEditingVehicle(null);
                }}
              >
                Close
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Vehicles Table */}
      <Card
        title='Vehicle List'
        subtitle={`${filteredVehicles.length} vehicles`}
      >
        {loading ? (
          <div className='text-center py-8'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto'></div>
            <p className='mt-2 text-gray-600'>Loading vehicles...</p>
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className='text-center py-8 text-gray-500'>
            No vehicles found matching your criteria.
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='fit-table fit-lg'>
              <thead className='bg-gray-50 border-b border-gray-200'>
                <tr>
                  <th className='px-3 py-2 text-left font-bold text-blue-700'>
                    S.No
                  </th>
                  <th className='px-3 py-2 text-left font-bold text-blue-700'>
                    Vehicle Number
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Type
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Particulars
                  </th>
                  <th className='px-3 py-2 text-center font-medium text-gray-700'>
                    Tax Expiry
                  </th>
                  <th className='px-3 py-2 text-center font-medium text-gray-700'>
                    Insurance Expiry
                  </th>
                  <th className='px-3 py-2 text-center font-medium text-gray-700'>
                    Fitness Expiry
                  </th>
                  <th className='px-3 py-2 text-center font-medium text-gray-700'>
                    Permit Expiry
                  </th>
                  <th className='px-3 py-2 text-center font-medium text-gray-700'>
                    Date Added
                  </th>
                  <th className='px-3 py-2 text-center font-medium text-gray-700'>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map(vehicle => {
                  const hasExpiringDoc = hasExpiringDocuments(vehicle);
                  const hasExpiredDoc = hasExpiredDocuments(vehicle);
                  const isExpiringSoon = hasExpiringDoc || hasExpiredDoc;
                  const isHighlighted = isHighlightActive && isExpiringSoon;

                  let rowBg = 'hover:bg-gray-50';
                  let borderClass = 'border-b border-gray-100';

                  if (isHighlighted) {
                    rowBg = 'bg-[#FEF3C7] hover:bg-[#FEF3C7]';
                    borderClass = 'border-2 border-[#F59E0B]';
                  } else if (isExpiringSoon) {
                    rowBg = 'bg-red-50 hover:bg-red-100';
                    borderClass = 'border-b border-red-200';
                  }

                  return (
                    <tr
                      key={vehicle.id}
                      id={`vehicle-row-${vehicle.id}`}
                      className={`transition-all duration-1000 ${borderClass} ${rowBg}`}
                    >
                      <td className='px-3 py-2 font-medium'>{vehicle.sno}</td>
                      <td className='px-3 py-2 font-bold text-blue-700'>
                        <div className="flex items-center gap-2">
                          {vehicle.v_no}
                          {isHighlighted && (
                            <span className='inline-flex items-center text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300 animate-pulse'>
                              🔔 Opened From Dashboard
                            </span>
                          )}
                        </div>
                        {(vehicle as any).pending_sync && (
                          <span className='inline-flex items-center text-[10px] font-bold text-amber-600 bg-amber-50 px-1 py-0.5 rounded border border-amber-200 mt-0.5 animate-pulse font-outfit'>
                            🔄 Pending Sync
                          </span>
                        )}
                      </td>
                      <td className='px-3 py-2'>{vehicle.v_type || ''}</td>
                      <td className='px-3 py-2'>{vehicle.particulars || ''}</td>
                      <td className='px-3 py-2 text-center'>
                        {vehicle.tax_exp_date ? (
                          <div className='flex flex-col items-center'>
                            <span
                              className={
                                getExpiryStatus(vehicle.tax_exp_date).status ===
                                'expired'
                                  ? 'text-red-600 font-semibold'
                                  : getExpiryStatus(vehicle.tax_exp_date)
                                        .status === 'expiring'
                                    ? 'text-orange-600 font-semibold'
                                    : ''
                              }
                            >
                              {format(
                                new Date(vehicle.tax_exp_date),
                                'dd-MM-yyyy'
                              )}
                            </span>
                            {getExpiryStatus(vehicle.tax_exp_date).status !==
                              'valid' && (
                              <span className='text-xs text-red-500 font-medium'>
                                {getExpiryStatus(vehicle.tax_exp_date)
                                  .status === 'expired'
                                  ? 'EXPIRED'
                                  : 'EXPIRING'}
                              </span>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className='px-3 py-2 text-center'>
                        {vehicle.insurance_exp_date ? (
                          <div className='flex flex-col items-center'>
                            <span
                              className={
                                getExpiryStatus(vehicle.insurance_exp_date)
                                  .status === 'expired'
                                  ? 'text-red-600 font-semibold'
                                  : getExpiryStatus(vehicle.insurance_exp_date)
                                        .status === 'expiring'
                                    ? 'text-orange-600 font-semibold'
                                    : ''
                              }
                            >
                              {format(
                                new Date(vehicle.insurance_exp_date),
                                'dd-MM-yyyy'
                              )}
                            </span>
                            {getExpiryStatus(vehicle.insurance_exp_date)
                              .status !== 'valid' && (
                              <span className='text-xs text-red-500 font-medium'>
                                {getExpiryStatus(vehicle.insurance_exp_date)
                                  .status === 'expired'
                                  ? 'EXPIRED'
                                  : 'EXPIRING'}
                              </span>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className='px-3 py-2 text-center'>
                        {vehicle.fitness_exp_date ? (
                          <div className='flex flex-col items-center'>
                            <span
                              className={
                                getExpiryStatus(vehicle.fitness_exp_date)
                                  .status === 'expired'
                                  ? 'text-red-600 font-semibold'
                                  : getExpiryStatus(vehicle.fitness_exp_date)
                                        .status === 'expiring'
                                    ? 'text-orange-600 font-semibold'
                                    : ''
                              }
                            >
                              {format(
                                new Date(vehicle.fitness_exp_date),
                                'dd-MM-yyyy'
                              )}
                            </span>
                            {getExpiryStatus(vehicle.fitness_exp_date)
                              .status !== 'valid' && (
                              <span className='text-xs text-red-500 font-medium'>
                                {getExpiryStatus(vehicle.fitness_exp_date)
                                  .status === 'expired'
                                  ? 'EXPIRED'
                                  : 'EXPIRING'}
                              </span>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className='px-3 py-2 text-center'>
                        {vehicle.permit_exp_date ? (
                          <div className='flex flex-col items-center'>
                            <span
                              className={
                                getExpiryStatus(vehicle.permit_exp_date)
                                  .status === 'expired'
                                  ? 'text-red-600 font-semibold'
                                  : getExpiryStatus(vehicle.permit_exp_date)
                                        .status === 'expiring'
                                    ? 'text-orange-600 font-semibold'
                                    : ''
                              }
                            >
                              {format(
                                new Date(vehicle.permit_exp_date),
                                'dd-MM-yyyy'
                              )}
                            </span>
                            {getExpiryStatus(vehicle.permit_exp_date).status !==
                              'valid' && (
                              <span className='text-xs text-red-500 font-medium'>
                                {getExpiryStatus(vehicle.permit_exp_date)
                                  .status === 'expired'
                                  ? 'EXPIRED'
                                  : 'EXPIRING'}
                              </span>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className='px-3 py-2 text-center'>
                        {vehicle.date_added
                          ? format(
                              new Date(vehicle.date_added || ''),
                              'dd-MM-yyyy'
                            )
                          : '-'}
                      </td>
                      <td className='px-3 py-2 text-center'>
                        <div className='flex items-center justify-center gap-2'>
                          {isExpiringSoon && (
                            <div className='flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium'>
                              <AlertTriangle className='w-3 h-3' />
                              EXPIRING
                            </div>
                          )}
                          <Button
                            size='sm'
                            variant='secondary'
                            onClick={() => handleViewDetails(vehicle)}
                            className='px-2'
                          >
                            View
                          </Button>
                          {!currentBook?.is_locked && (
                            <>
                              <Button
                                size='sm'
                                variant='secondary'
                                icon={Edit}
                                onClick={() => handleEdit(vehicle)}
                                className='px-2'
                              >
                                Edit
                              </Button>
                              <Button
                                size='sm'
                                variant='danger'
                                onClick={() => handleDelete(vehicle.id)}
                                className='px-2'
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Vehicle Details Modal */}
      {showDetails && selectedVehicle && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto'>
            <div className='p-6'>
              <div className='flex items-center justify-between mb-6'>
                <h3 className='text-lg font-semibold flex items-center gap-2'>
                  <Truck className='w-5 h-5' />
                  Vehicle Details - {selectedVehicle.v_no}
                </h3>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={() => setShowDetails(false)}
                >
                  Close
                </Button>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
                <div className='space-y-4'>
                  <div className='bg-blue-50 p-4 rounded-lg'>
                    <h4 className='font-medium text-blue-900 mb-3'>
                      Vehicle Information
                    </h4>
                    <div className='space-y-2 text-sm'>
                      <div>
                        <strong>S.No:</strong> {selectedVehicle.sno}
                      </div>
                      <div>
                        <strong>Vehicle Number:</strong> {selectedVehicle.v_no}
                      </div>
                      <div>
                        <strong>Type:</strong> {selectedVehicle.v_type}
                      </div>
                      <div>
                        <strong>Particulars:</strong>{' '}
                        {selectedVehicle.particulars}
                      </div>
                    </div>
                  </div>
                </div>

                <div className='space-y-4'>
                  <div className='bg-green-50 p-4 rounded-lg'>
                    <h4 className='font-medium text-green-900 mb-3'>
                      Document Expiry Status
                    </h4>
                    <div className='space-y-3 text-sm'>
                      {[
                        {
                          label: 'Tax Expiry',
                          date: selectedVehicle.tax_exp_date,
                        },
                        {
                          label: 'Insurance Expiry',
                          date: selectedVehicle.insurance_exp_date,
                        },
                        {
                          label: 'Fitness Expiry',
                          date: selectedVehicle.fitness_exp_date,
                        },
                        {
                          label: 'Permit Expiry',
                          date: selectedVehicle.permit_exp_date,
                        },
                      ].map(({ label, date }) => {
                        const status = getExpiryStatus(date);
                        return (
                          <div
                            key={label}
                            className='flex items-center justify-between'
                          >
                            <span>
                              <strong>{label}:</strong>
                            </span>
                            <div className='text-right'>
                              <div
                                className={`px-2 py-1 rounded text-xs font-medium ${status.color}`}
                              >
                                {date && date !== ''
                                  ? format(new Date(date), 'MMM dd, yyyy')
                                  : '-'}
                              </div>
                              <div className='text-xs text-gray-500 mt-1'>
                                {status.status === 'expired'
                                  ? `Expired ${status.days} days ago`
                                  : `${status.days} days remaining`}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              {/* RC Images Section - Improved UI */}
              {selectedVehicle && (
                <div className='mt-8 grid grid-cols-1 md:grid-cols-2 gap-8 items-center'>
                  {selectedVehicle.rc_front_url && (
                    <div className='flex flex-col items-center'>
                      <div className='mb-2 text-sm text-gray-700 font-medium'>
                        RC Front Photo
                      </div>
                      <img
                        src={selectedVehicle.rc_front_url}
                        alt='RC Front'
                        className='w-full max-w-md h-auto aspect-[4/3] object-cover rounded-xl shadow-lg border-2 border-blue-200 cursor-pointer hover:scale-105 transition-transform'
                        onClick={() =>
                          setImageModal({
                            url: selectedVehicle.rc_front_url || '',
                            label: 'RC Front Photo',
                          })
                        }
                      />
                    </div>
                  )}
                  {selectedVehicle.rc_back_url && (
                    <div className='flex flex-col items-center'>
                      <div className='mb-2 text-sm text-gray-700 font-medium'>
                        RC Back Photo
                      </div>
                      <img
                        src={selectedVehicle.rc_back_url}
                        alt='RC Back'
                        className='w-full max-w-md h-auto aspect-[4/3] object-cover rounded-xl shadow-lg border-2 border-blue-200 cursor-pointer hover:scale-105 transition-transform'
                        onClick={() =>
                          setImageModal({
                            url: selectedVehicle.rc_back_url || '',
                            label: 'RC Back Photo',
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Image Modal for separate viewing */}
      {imageModal && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80'
          onClick={() => setImageModal(null)}
        >
          <div
            className='relative max-w-2xl w-full p-4'
            onClick={e => e.stopPropagation()}
          >
            <button
              className='absolute top-2 right-2 bg-white rounded-full p-2 shadow hover:bg-gray-100'
              onClick={() => setImageModal(null)}
            >
              <X className='w-6 h-6 text-gray-700' />
            </button>
            <div className='flex flex-col items-center'>
              <img
                src={imageModal.url}
                alt={imageModal.label}
                className='w-full max-w-2xl h-auto aspect-[4/3] object-contain rounded-xl shadow-lg border-2 border-blue-300'
              />
              <div className='mt-2 text-white text-lg font-semibold text-center'>
                {imageModal.label}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Vehicles;
