const Booking = require("../models/Booking")
const Service = require("../models/Service")
const Worker = require("../models/Worker")
const Payment = require("../models/Payment")
const Notification = require("../models/Notification")

// Create booking
exports.createBooking = async (req, res) => {
  try {
    console.log('=== CREATE BOOKING REQUEST ===')
    console.log('Full request body:', req.body)
    console.log('User ID:', req.user?.userId)
    
    const {
      service: serviceId,
      worker: workerId,
      date,
      time,
      address,
      notes,
      description,
      customerLocation,
    } = req.body

    // Use description as notes if notes not provided
    const bookingNotes = notes || description

    console.log('Extracted fields:')
    console.log('- serviceId:', serviceId, typeof serviceId)
    console.log('- workerId:', workerId, typeof workerId)
    console.log('- date:', date, typeof date)
    console.log('- time:', time, typeof time)
    console.log('- address:', address, typeof address)
    console.log('- notes:', bookingNotes, typeof bookingNotes)
    console.log('============================')

    // Validate required fields
    if (!serviceId || !workerId || !date || !time || !address) {
      console.log('VALIDATION FAILED - Missing fields:')
      console.log('serviceId missing?', !serviceId)
      console.log('workerId missing?', !workerId)
      console.log('date missing?', !date)
      console.log('time missing?', !time)
      console.log('address missing?', !address)
      return res.status(400).json({
        success: false,
        message: "Service, worker, date, time, and address are required",
      })
    }

    // Check if service exists
    const service = await Service.findById(serviceId)
    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found" })
    }

    // Check if worker exists
    const worker = await Worker.findById(workerId)
    if (!worker) {
      return res.status(404).json({ success: false, message: "Worker not found" })
    }

    // Check if worker is available
    if (!worker.isAvailable) {
      return res.status(400).json({ 
        success: false, 
        message: "Worker is currently unavailable. Please choose another worker or try again later." 
      })
    }

    // Determine the price - first check worker's specific pricing for this service
    let bookingPrice = service.price || 0
    if (worker.pricing && Array.isArray(worker.pricing)) {
      const workerServicePrice = worker.pricing.find(
        p => p.serviceName?.toLowerCase() === service.name.toLowerCase()
      )
      if (workerServicePrice && workerServicePrice.price > 0) {
        bookingPrice = workerServicePrice.price
      }
    }

    // Create booking
    const booking = new Booking({
      customer: req.user.userId,
      worker: workerId,
      service: serviceId,
      date: new Date(date),
      time,
      address,
      notes: bookingNotes,
      price: bookingPrice,
      customerLocation,
      statusHistory: [
        {
          status: "pending",
          timestamp: new Date(),
          notes: "Booking created",
        },
      ],
    })

    await booking.save()

    // Create notification for worker
    await Notification.create({
      user: worker.user,
      title: "New Booking Request",
      message: `You have received a new booking request for ${service.name}`,
      type: "booking",
      link: `/dashboard/worker/bookings/${booking._id}`,
      relatedId: booking._id,
      relatedModel: "Booking",
    })

    // Emit socket event to worker
    if (req.app && req.app.io) {
      req.app.io.to(`user-${worker.user}`).emit("new-booking", {
        booking: booking.toObject(),
        service: service.toObject(),
      })
    }

    res.status(201).json({
      success: true,
      message: "Booking created successfully",
      booking,
    })
  } catch (error) {
    console.error("Create booking error:", error)
    res.status(500).json({ success: false, message: "Failed to create booking" })
  }
}

// Create broadcast booking (send to all available workers)
exports.createBroadcastBooking = async (req, res) => {
  try {
    const {
      service: serviceId,
      workers: workerIds, // Array of worker IDs
      date,
      time,
      address,
      notes,
      description,
      customerLocation,
    } = req.body

    const bookingNotes = notes || description

    // Validate required fields
    if (!serviceId || !workerIds || workerIds.length === 0 || !date || !time || !address) {
      return res.status(400).json({
        success: false,
        message: "Service, workers, date, time, and address are required",
      })
    }

    // Check if service exists
    const service = await Service.findById(serviceId)
    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found" })
    }

    // Generate a unique broadcast group ID
    const broadcastGroup = `broadcast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const createdBookings = []
    const failedWorkers = []

    // Create a booking for each worker
    for (const workerId of workerIds) {
      try {
        const worker = await Worker.findById(workerId)
        if (!worker) {
          failedWorkers.push({ workerId, reason: "Worker not found" })
          continue
        }

        // Skip unavailable workers in broadcast booking
        if (!worker.isAvailable) {
          failedWorkers.push({ workerId, reason: "Worker is currently unavailable" })
          continue
        }

        // Determine the price
        let bookingPrice = service.price || 0
        if (worker.pricing && Array.isArray(worker.pricing)) {
          const workerServicePrice = worker.pricing.find(
            p => p.serviceName?.toLowerCase() === service.name.toLowerCase()
          )
          if (workerServicePrice && workerServicePrice.price > 0) {
            bookingPrice = workerServicePrice.price
          }
        }

        // Create booking
        const booking = new Booking({
          customer: req.user.userId,
          worker: workerId,
          service: serviceId,
          date: new Date(date),
          time,
          address,
          notes: bookingNotes,
          price: bookingPrice,
          customerLocation,
          isBroadcast: true,
          broadcastGroup,
          broadcastStatus: "active",
          statusHistory: [
            {
              status: "pending",
              timestamp: new Date(),
              notes: "Broadcast booking created",
            },
          ],
        })

        await booking.save()
        createdBookings.push(booking)

        // Create notification for worker
        await Notification.create({
          user: worker.user,
          title: "New Booking Request",
          message: `You have received a new booking request for ${service.name}`,
          type: "booking",
          link: `/dashboard/worker/bookings/${booking._id}`,
          relatedId: booking._id,
          relatedModel: "Booking",
        })

        // Emit socket event to worker
        if (req.app && req.app.io) {
          req.app.io.to(`user-${worker.user}`).emit("new-booking", {
            booking: booking.toObject(),
            service: service.toObject(),
          })
        }
      } catch (error) {
        console.error(`Failed to create booking for worker ${workerId}:`, error)
        failedWorkers.push({ workerId, reason: error.message })
      }
    }

    res.status(201).json({
      success: true,
      message: `Broadcast booking created. Sent to ${createdBookings.length} workers.`,
      bookings: createdBookings,
      broadcastGroup,
      failed: failedWorkers,
    })
  } catch (error) {
    console.error("Create broadcast booking error:", error)
    res.status(500).json({ success: false, message: "Failed to create broadcast booking" })
  }
}

// Get user bookings
exports.getUserBookings = async (req, res) => {
  try {
    const { status, limit = 20, page = 1 } = req.query

    const query = {}
    
    // Filter by role
    if (req.user.role === "customer") {
      query.customer = req.user.userId
    } else if (req.user.role === "worker") {
      const worker = await Worker.findOne({ user: req.user.userId })
      if (!worker) {
        return res.status(404).json({ success: false, message: "Worker profile not found" })
      }
      query.worker = worker._id
      // Don't show auto-rejected broadcast bookings to workers
      query.$or = [
        { isBroadcast: { $ne: true } },
        { isBroadcast: true, broadcastStatus: { $ne: "auto-rejected" } }
      ]
    }

    if (status) {
      query.status = status
    }

    const bookings = await Booking.find(query)
      .populate("customer", "name email phone profilePicture address addresses")
      .populate("service", "name category basePrice")
      .populate({
        path: "worker",
        populate: { path: "user", select: "name email phone profilePicture address" },
      })
      .populate("payment")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))

    const total = await Booking.countDocuments(query)

    res.json({
      success: true,
      bookings,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    })
  } catch (error) {
    console.error("Get bookings error:", error)
    res.status(500).json({ success: false, message: "Failed to fetch bookings" })
  }
}

// Get booking by ID
exports.getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate("customer", "name email phone profilePicture address addresses")
      .populate("service", "name category basePrice description")
      .populate({
        path: "worker",
        populate: { path: "user", select: "name email phone profilePicture address" },
      })
      .populate("payment")

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    // Check authorization
    const worker = await Worker.findOne({ user: req.user.userId })
    const isAuthorized =
      booking.customer.toString() === req.user.userId ||
      (worker && booking.worker._id.toString() === worker._id.toString()) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    res.json({
      success: true,
      booking,
    })
  } catch (error) {
    console.error("Get booking error:", error)
    res.status(500).json({ success: false, message: "Failed to fetch booking" })
  }
}

// Update booking status
exports.updateBookingStatus = async (req, res) => {
  try {
    const { status, notes } = req.body
    const booking = await Booking.findById(req.params.id)

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    // Authorization check
    const worker = await Worker.findOne({ user: req.user.userId })
    const isWorker = worker && booking.worker.toString() === worker._id.toString()
    const isCustomer = booking.customer.toString() === req.user.userId

    if (!isWorker && !isCustomer && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    // Update status
    booking.status = status
    booking.statusHistory.push({
      status,
      timestamp: new Date(),
      notes,
    })

    if (status === "in_progress") {
      booking.actualStartTime = new Date()
    } else if (status === "completed") {
      booking.completionTime = new Date()
    }

    await booking.save()

    // Create notification
    const notifyUserId = isWorker ? booking.customer : worker.user
    await Notification.create({
      user: notifyUserId,
      title: `Booking ${status}`,
      message: `Your booking has been ${status.replace("_", " ")}`,
      type: "booking",
      link: `/ dashboard/bookings/${booking._id}`,
      relatedId: booking._id,
      relatedModel: "Booking",
    })

    // Emit socket event
    if (req.app.io) {
      req.app.io.to(`user-${notifyUserId}`).emit("booking-updated", {
        bookingId: booking._id,
        status,
      })
    }

    res.json({
      success: true,
      message: "Booking status updated",
      booking,
    })
  } catch (error) {
    console.error("Update booking error:", error)
    res.status(500).json({ success: false, message: "Failed to update booking" })
  }
}

// Cancel booking
exports.cancelBooking = async (req, res) => {
  try {
    const { reason } = req.body
    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name')

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    // Only customer can cancel
    if (booking.customer.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (booking.status === "completed" || booking.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel completed or already cancelled booking",
      })
    }

    // Allow cancellation of pending AND accepted bookings
    if (!["pending", "accepted"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Can only cancel pending or accepted bookings",
      })
    }

    booking.status = "cancelled"
    booking.cancellationReason = reason || "No reason provided"
    booking.statusHistory.push({
      status: "cancelled",
      timestamp: new Date(),
      notes: reason ? `Cancelled by customer: ${reason}` : "Cancelled by customer",
    })

    await booking.save()

    // Refund if payment was made
    if (booking.payment && booking.paymentStatus === "completed") {
      await Payment.findByIdAndUpdate(booking.payment, { status: "refunded" })
    }

    // Notify the assigned worker about cancellation
    if (booking.worker) {
      const worker = await Worker.findById(booking.worker).populate('user', '_id name')
      if (worker && worker.user) {
        await Notification.create({
          user: worker.user._id,
          title: "Booking Cancelled",
          message: `A booking for ${booking.service?.name || 'service'} was cancelled by the customer${reason ? ': ' + reason : ''}`,
          type: "booking",
          link: `/dashboard/worker/bookings`
        })

        // Emit socket event to worker
        if (req.app && req.app.io) {
          req.app.io.to(`user-${worker.user._id}`).emit("booking-cancelled", {
            bookingId: booking._id,
            reason: reason || "No reason provided"
          })
        }
      }
    }

    res.json({
      success: true,
      message: "Booking cancelled successfully",
      booking,
    })
  } catch (error) {
    console.error("Cancel booking error:", error)
    res.status(500).json({ success: false, message: "Failed to cancel booking" })
  }
}

// Worker accept booking
exports.acceptBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name')
      .populate('customer', 'name')
    
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    const worker = await Worker.findOne({ user: req.user.userId }).populate('user', 'name')
    if (!worker || booking.worker.toString() !== worker._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (booking.status !== "pending") {
      return res.status(400).json({ success: false, message: "Booking cannot be accepted" })
    }

    // Check if this is a broadcast booking that's already been accepted by another worker
    if (booking.isBroadcast && booking.broadcastStatus === "auto-rejected") {
      return res.status(400).json({ 
        success: false, 
        message: "This booking has already been accepted by another worker" 
      })
    }

    // Set to accepted status (intermediate state before completion)
    booking.status = "accepted"
    booking.statusHistory.push({ 
      status: "accepted", 
      timestamp: new Date(),
      notes: "Worker accepted the job"
    })

    // If this is a broadcast booking, update related bookings
    if (booking.isBroadcast && booking.broadcastGroup) {
      booking.broadcastStatus = "accepted"
      booking.acceptedBy = worker._id
      await booking.save()

      // Auto-reject all other bookings in the same broadcast group
      const otherBookings = await Booking.find({
        broadcastGroup: booking.broadcastGroup,
        _id: { $ne: booking._id },
        status: "pending"
      }).populate('worker', 'user')

      for (const otherBooking of otherBookings) {
        otherBooking.status = "rejected"
        otherBooking.broadcastStatus = "auto-rejected"
        otherBooking.acceptedBy = worker._id
        otherBooking.statusHistory.push({
          status: "rejected",
          timestamp: new Date(),
          notes: `Auto-rejected: Another worker (${worker.user?.name || 'Worker'}) accepted the booking`
        })
        await otherBooking.save()

        // Notify the worker whose booking was auto-rejected
        if (otherBooking.worker) {
          const otherWorker = await Worker.findById(otherBooking.worker).populate('user')
          if (otherWorker && otherWorker.user) {
            await Notification.create({
              user: otherWorker.user._id,
              title: "Booking Taken",
              message: `The booking for ${booking.service?.name || 'service'} was accepted by another worker`,
              type: "booking",
              link: `/dashboard/worker/bookings`
            })

            // Emit socket event
            if (req.app && req.app.io) {
              req.app.io.to(`user-${otherWorker.user._id}`).emit("booking-rejected", {
                booking: otherBooking.toObject(),
                reason: "accepted_by_another"
              })
            }
          }
        }
      }
    } else {
      await booking.save()
    }

    // Notify customer
    await Notification.create({
      user: booking.customer,
      title: "Booking Accepted",
      message: `Your booking for ${booking.service?.name || 'service'} has been accepted by ${worker.user?.name || 'the worker'}`,
      type: "booking",
      link: `/dashboard/customer/bookings/${booking._id}`
    })

    // Emit socket event to customer
    if (req.app && req.app.io) {
      req.app.io.to(`user-${booking.customer}`).emit("booking-accepted", {
        booking: booking.toObject()
      })
    }

    res.json({ success: true, message: "Booking accepted successfully", booking })
  } catch (error) {
    console.error("Accept booking error:", error)
    res.status(500).json({ success: false, message: "Failed to accept booking" })
  }
}

// Worker reject booking
exports.rejectBooking = async (req, res) => {
  try {
    const { reason } = req.body
    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name category price')
      .populate('customer', 'name email')
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    const worker = await Worker.findOne({ user: req.user.userId }).populate('user', 'name')
    if (!worker || booking.worker.toString() !== worker._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (booking.status !== "pending") {
      return res.status(400).json({ success: false, message: "Booking cannot be rejected" })
    }

    booking.status = "rejected"
    booking.statusHistory.push({ status: "rejected", timestamp: new Date(), notes: reason })
    
    // Track this worker in rejectedWorkers array
    if (!booking.rejectedWorkers) booking.rejectedWorkers = []
    booking.rejectedWorkers.push({
      worker: worker._id,
      reason: reason || 'No reason provided',
      rejectedAt: new Date()
    })
    
    await booking.save()

    // Increment worker's jobsRejected count
    worker.jobsRejected = (worker.jobsRejected || 0) + 1
    await worker.save()

    // ── Fallback: Find alternative available workers for the same service category ──
    const rejectedWorkerIds = (booking.rejectedWorkers || []).map(rw => rw.worker.toString())
    rejectedWorkerIds.push(worker._id.toString())

    const alternativeWorkers = await Worker.find({
      serviceCategory: booking.service?.category || '',
      isAvailable: true,
      _id: { $nin: rejectedWorkerIds.map(id => id) }
    })
      .populate('user', 'name profilePicture')
      .select('user serviceCategory skills experience rating pricing jobsCompleted isAvailable')
      .sort({ rating: -1 })
      .limit(5)

    // Build suggested workers summary for notification
    const suggestedWorkers = alternativeWorkers.map(w => ({
      workerId: w._id,
      name: w.user?.name || 'Worker',
      profilePicture: w.user?.profilePicture || null,
      rating: w.rating || 0,
      experience: w.experience || 0,
      jobsCompleted: w.jobsCompleted || 0,
      price: (() => {
        if (w.pricing && Array.isArray(w.pricing)) {
          const match = w.pricing.find(p => p.serviceName?.toLowerCase() === booking.service?.name?.toLowerCase())
          return match?.price || booking.service?.price || 0
        }
        return booking.service?.price || 0
      })()
    }))

    const availableCount = alternativeWorkers.length

    // Build rich notification message
    let notifMessage = `Your booking for ${booking.service?.name || 'service'} was declined by ${worker.user?.name || 'the worker'}`
    if (reason) notifMessage += ` — Reason: "${reason}"`
    if (availableCount > 0) {
      notifMessage += `. We found ${availableCount} alternative worker${availableCount > 1 ? 's' : ''} for you!`
    } else {
      notifMessage += '. No alternative workers are currently available. You can try again later or broadcast to all workers.'
    }

    // Create rich notification with metadata
    await Notification.create({
      user: booking.customer._id || booking.customer,
      title: "Booking Declined — Alternatives Available",
      message: notifMessage,
      type: "warning",
      actionType: availableCount > 0 ? "rebook" : "broadcast",
      link: `/dashboard/customer/bookings`,
      relatedId: booking._id,
      relatedModel: "Booking",
      metadata: {
        bookingId: booking._id,
        serviceId: booking.service?._id,
        serviceName: booking.service?.name,
        serviceCategory: booking.service?.category,
        rejectedByWorker: worker.user?.name || 'Worker',
        rejectionReason: reason || null,
        suggestedWorkers,
        availableCount,
        originalDate: booking.date,
        originalTime: booking.time,
        originalAddress: booking.address,
        originalPrice: booking.price
      }
    })

    // Emit real-time socket event to customer with alternatives
    if (req.app.io) {
      req.app.io.to(`user-${booking.customer._id || booking.customer}`).emit("booking-rejected", {
        booking: booking.toObject(),
        rejectedBy: worker.user?.name || 'Worker',
        reason: reason || null,
        suggestedWorkers,
        availableCount
      })
    }

    res.json({ 
      success: true, 
      message: "Booking rejected", 
      booking,
      alternativeWorkers: suggestedWorkers,
      availableCount
    })
  } catch (error) {
    console.error("Reject booking error:", error)
    res.status(500).json({ success: false, message: "Failed to reject booking" })
  }
}

// ── FALLBACK: Get alternative workers for a rejected booking ──
exports.getAlternativeWorkers = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name category price')

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    // Only the booking customer can request alternatives
    if (booking.customer.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (booking.status !== "rejected" && booking.status !== "cancelled") {
      return res.status(400).json({ success: false, message: "Alternatives are only available for rejected/cancelled bookings" })
    }

    // Collect all workers who already rejected this booking
    const excludeIds = (booking.rejectedWorkers || []).map(rw => rw.worker)
    excludeIds.push(booking.worker) // also exclude originally assigned worker

    const alternativeWorkers = await Worker.find({
      serviceCategory: booking.service?.category || '',
      isAvailable: true,
      _id: { $nin: excludeIds }
    })
      .populate('user', 'name email profilePicture')
      .select('user serviceCategory skills experience rating pricing jobsCompleted isAvailable')
      .sort({ rating: -1 })

    const formattedWorkers = alternativeWorkers.map(w => ({
      workerId: w._id,
      userId: w.user?._id,
      name: w.user?.name || 'Worker',
      profilePicture: w.user?.profilePicture || null,
      rating: w.rating || 0,
      experience: w.experience || 0,
      skills: w.skills || [],
      jobsCompleted: w.jobsCompleted || 0,
      price: (() => {
        if (w.pricing && Array.isArray(w.pricing)) {
          const match = w.pricing.find(p => p.serviceName?.toLowerCase() === booking.service?.name?.toLowerCase())
          return match?.price || booking.service?.price || 0
        }
        return booking.service?.price || 0
      })()
    }))

    res.json({
      success: true,
      alternatives: formattedWorkers,
      booking: {
        _id: booking._id,
        service: booking.service,
        date: booking.date,
        time: booking.time,
        address: booking.address,
        notes: booking.notes,
        price: booking.price,
        rejectedWorkers: booking.rejectedWorkers
      }
    })
  } catch (error) {
    console.error("Get alternatives error:", error)
    res.status(500).json({ success: false, message: "Failed to fetch alternative workers" })
  }
}

// ── FALLBACK: Re-book with a different worker (one-click rebook) ──
exports.rebookWithWorker = async (req, res) => {
  try {
    const { workerId } = req.body
    const originalBooking = await Booking.findById(req.params.id)
      .populate('service', 'name category price')

    if (!originalBooking) {
      return res.status(404).json({ success: false, message: "Original booking not found" })
    }

    if (originalBooking.customer.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (originalBooking.status !== "rejected" && originalBooking.status !== "cancelled") {
      return res.status(400).json({ success: false, message: "Can only rebook rejected or cancelled bookings" })
    }

    if (!workerId) {
      return res.status(400).json({ success: false, message: "Worker ID is required" })
    }

    // Validate the new worker
    const newWorker = await Worker.findById(workerId).populate('user', 'name')
    if (!newWorker) {
      return res.status(404).json({ success: false, message: "Worker not found" })
    }
    if (!newWorker.isAvailable) {
      return res.status(400).json({ success: false, message: "This worker is currently unavailable" })
    }

    // Determine pricing for the new worker
    let bookingPrice = originalBooking.service?.price || originalBooking.price || 0
    if (newWorker.pricing && Array.isArray(newWorker.pricing)) {
      const match = newWorker.pricing.find(
        p => p.serviceName?.toLowerCase() === originalBooking.service?.name?.toLowerCase()
      )
      if (match?.price > 0) bookingPrice = match.price
    }

    // Carry over the rejection history from the original booking
    const rejectedWorkers = [...(originalBooking.rejectedWorkers || [])]

    // Create a new booking cloned from the original
    const newBooking = new Booking({
      customer: originalBooking.customer,
      worker: workerId,
      service: originalBooking.service._id,
      date: originalBooking.date,
      time: originalBooking.time,
      address: originalBooking.address,
      notes: originalBooking.notes ? `[Re-booked] ${originalBooking.notes}` : '[Re-booked from a declined request]',
      price: bookingPrice,
      customerLocation: originalBooking.customerLocation,
      rejectedWorkers,
      statusHistory: [
        {
          status: "pending",
          timestamp: new Date(),
          notes: `Re-booked after rejection (original booking: ${originalBooking._id})`
        }
      ]
    })

    await newBooking.save()

    // Notify the new worker
    await Notification.create({
      user: newWorker.user._id || newWorker.user,
      title: "New Booking Request",
      message: `You have received a new booking request for ${originalBooking.service?.name || 'service'}`,
      type: "booking",
      link: `/dashboard/worker/bookings/${newBooking._id}`,
      relatedId: newBooking._id,
      relatedModel: "Booking"
    })

    // Emit socket event to new worker
    if (req.app.io) {
      req.app.io.to(`user-${newWorker.user._id || newWorker.user}`).emit("new-booking", {
        booking: newBooking.toObject(),
        service: originalBooking.service
      })
    }

    // Notify the customer
    await Notification.create({
      user: req.user.userId,
      title: "Re-Booked Successfully",
      message: `Your booking for ${originalBooking.service?.name || 'service'} has been sent to ${newWorker.user?.name || 'a new worker'}. Awaiting confirmation.`,
      type: "success",
      link: `/dashboard/customer/bookings`,
      relatedId: newBooking._id,
      relatedModel: "Booking"
    })

    res.status(201).json({
      success: true,
      message: `Booking re-sent to ${newWorker.user?.name || 'new worker'}. Awaiting their response.`,
      booking: newBooking
    })
  } catch (error) {
    console.error("Rebook error:", error)
    res.status(500).json({ success: false, message: "Failed to rebook" })
  }
}

// ── FALLBACK: Broadcast rejected booking to all available workers ──
exports.broadcastRejectedBooking = async (req, res) => {
  try {
    const originalBooking = await Booking.findById(req.params.id)
      .populate('service', 'name category price')

    if (!originalBooking) {
      return res.status(404).json({ success: false, message: "Original booking not found" })
    }

    if (originalBooking.customer.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (originalBooking.status !== "rejected" && originalBooking.status !== "cancelled") {
      return res.status(400).json({ success: false, message: "Can only broadcast rejected or cancelled bookings" })
    }

    // Find all available workers excluding those who already rejected
    const excludeIds = (originalBooking.rejectedWorkers || []).map(rw => rw.worker)
    excludeIds.push(originalBooking.worker)

    const availableWorkers = await Worker.find({
      serviceCategory: originalBooking.service?.category || '',
      isAvailable: true,
      _id: { $nin: excludeIds }
    }).populate('user', 'name')

    if (availableWorkers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No available workers found for this service. Please try again later."
      })
    }

    const broadcastGroup = `broadcast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const createdBookings = []

    for (const w of availableWorkers) {
      let bookingPrice = originalBooking.service?.price || originalBooking.price || 0
      if (w.pricing && Array.isArray(w.pricing)) {
        const match = w.pricing.find(p => p.serviceName?.toLowerCase() === originalBooking.service?.name?.toLowerCase())
        if (match?.price > 0) bookingPrice = match.price
      }

      const bk = new Booking({
        customer: originalBooking.customer,
        worker: w._id,
        service: originalBooking.service._id,
        date: originalBooking.date,
        time: originalBooking.time,
        address: originalBooking.address,
        notes: originalBooking.notes ? `[Broadcast Re-book] ${originalBooking.notes}` : '[Broadcast after declined request]',
        price: bookingPrice,
        customerLocation: originalBooking.customerLocation,
        isBroadcast: true,
        broadcastGroup,
        broadcastStatus: "active",
        rejectedWorkers: [...(originalBooking.rejectedWorkers || [])],
        statusHistory: [{
          status: "pending",
          timestamp: new Date(),
          notes: `Broadcast re-book after rejection (original: ${originalBooking._id})`
        }]
      })

      await bk.save()
      createdBookings.push(bk)

      await Notification.create({
        user: w.user._id || w.user,
        title: "New Booking Request",
        message: `You have a new booking request for ${originalBooking.service?.name || 'service'}`,
        type: "booking",
        link: `/dashboard/worker/bookings/${bk._id}`,
        relatedId: bk._id,
        relatedModel: "Booking"
      })

      if (req.app.io) {
        req.app.io.to(`user-${w.user._id || w.user}`).emit("new-booking", {
          booking: bk.toObject(),
          service: originalBooking.service
        })
      }
    }

    // Notify customer
    await Notification.create({
      user: req.user.userId,
      title: "Broadcast Sent",
      message: `Your booking for ${originalBooking.service?.name || 'service'} has been sent to ${createdBookings.length} available worker(s). The first to accept will be assigned.`,
      type: "success",
      link: `/dashboard/customer/bookings`
    })

    res.status(201).json({
      success: true,
      message: `Booking broadcast sent to ${createdBookings.length} workers`,
      bookings: createdBookings,
      broadcastGroup
    })
  } catch (error) {
    console.error("Broadcast rebook error:", error)
    res.status(500).json({ success: false, message: "Failed to broadcast booking" })
  }
}

// Worker start booking
exports.startBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    const worker = await Worker.findOne({ user: req.user.userId })
    if (!worker || booking.worker.toString() !== worker._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (booking.status !== "accepted") {
      return res.status(400).json({ success: false, message: "Booking must be accepted first" })
    }

    booking.status = "in-progress"
    booking.statusHistory.push({ status: "in-progress", timestamp: new Date() })
    await booking.save()

    await Notification.create({
      user: booking.customer,
      title: "Work Started",
      message: `Work has started on your booking`,
      type: "booking",
      link: `/dashboard/customer/bookings/${booking._id}`
    })

    res.json({ success: true, message: "Work started", booking })
  } catch (error) {
    console.error("Start booking error:", error)
    res.status(500).json({ success: false, message: "Failed to start booking" })
  }
}

// Worker complete booking
exports.completeBooking = async (req, res) => {
  try {
    const { finalPrice } = req.body
    const booking = await Booking.findById(req.params.id)
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    const worker = await Worker.findOne({ user: req.user.userId })
    if (!worker || booking.worker.toString() !== worker._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (booking.status !== "in-progress" && booking.status !== "accepted") {
      return res.status(400).json({ success: false, message: "Booking must be accepted or in progress" })
    }

    booking.status = "completed"
    booking.completedAt = new Date()
    const earnedAmount = finalPrice && parseFloat(finalPrice) > 0 ? parseFloat(finalPrice) : booking.price
    booking.finalPrice = earnedAmount
    
    booking.statusHistory.push({ 
      status: "completed", 
      timestamp: new Date(),
      notes: `Final price: ₹${earnedAmount}`
    })
    await booking.save()

    // Update worker earnings and completed jobs count
    worker.earnings = (worker.earnings || 0) + earnedAmount
    worker.jobsCompleted = (worker.jobsCompleted || 0) + 1
    await worker.save()

    await Notification.create({
      user: booking.customer,
      title: "Work Completed",
      message: `Work has been completed. Please leave a review!`,
      type: "booking",
      link: `/dashboard/customer/bookings/${booking._id}`
    })

    res.json({ success: true, message: "Booking completed and earnings updated", booking, earnings: worker.earnings })
  } catch (error) {
    console.error("Complete booking error:", error)
    res.status(500).json({ success: false, message: "Failed to complete booking" })
  }
}

// Add review to booking
exports.addReview = async (req, res) => {
  try {
    const { rating, review } = req.body
    const booking = await Booking.findById(req.params.id)

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    if (booking.customer.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    if (booking.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Can only review completed bookings",
      })
    }

    booking.rating = rating
    booking.review = review
    booking.isReviewed = true
    await booking.save()

    // Update worker rating - use reviews count for average calculation
    const worker = await Worker.findById(booking.worker)
    const reviewedBookings = await Booking.countDocuments({
      worker: booking.worker,
      isReviewed: true
    })
    
    // Calculate new average rating based on all reviewed bookings
    const allReviewedBookings = await Booking.find({
      worker: booking.worker,
      isReviewed: true
    }).select('rating')
    
    const totalRating = allReviewedBookings.reduce((sum, b) => sum + (b.rating || 0), 0)
    worker.rating = reviewedBookings > 0 ? totalRating / reviewedBookings : rating
    
    // Also add to worker's reviews array
    worker.reviews.push({
      customer: req.user.userId,
      rating: rating,
      comment: review,
      date: new Date()
    })
    
    await worker.save()

    res.json({
      success: true,
      message: "Review added successfully",
      booking,
    })
  } catch (error) {
    console.error("Add review error:", error)
    res.status(500).json({ success: false, message: "Failed to add review" })
  }
}

// Share live location with worker
exports.shareLiveLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body
    const bookingId = req.params.id

    if (!latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        message: "Latitude and longitude are required" 
      })
    }

    const booking = await Booking.findById(bookingId)
      .populate('worker', 'user')
      .populate('service', 'name')
    
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    // Verify the customer owns this booking
    if (booking.customer.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    // Only allow location sharing if booking is accepted or in-progress
    if (booking.status !== 'accepted' && booking.status !== 'in-progress' && booking.status !== 'in_progress') {
      return res.status(400).json({ 
        success: false, 
        message: "Location can only be shared when booking is accepted by a worker" 
      })
    }

    // Verify a worker is assigned
    if (!booking.worker) {
      return res.status(400).json({ 
        success: false, 
        message: "No worker assigned to this booking yet" 
      })
    }

    // Update customer location
    booking.customerLocation = {
      latitude,
      longitude,
      shareLocation: true,
      lastUpdated: new Date()
    }

    await booking.save()

    // Notify worker with location update
    if (booking.worker && booking.worker.user) {
      await Notification.create({
        user: booking.worker.user,
        title: "Customer Location Shared",
        message: `Customer has shared their live location for ${booking.service?.name || 'service'}`,
        type: "location",
        link: `/dashboard/worker/bookings/${booking._id}`
      })

      // Emit socket event to worker
      if (req.app.io) {
        req.app.io.to(`user-${booking.worker.user}`).emit("location-shared", {
          bookingId: booking._id,
          location: {
            latitude,
            longitude
          }
        })
      }
    }

    res.json({
      success: true,
      message: "Location shared successfully",
      location: booking.customerLocation
    })
  } catch (error) {
    console.error("Share location error:", error)
    res.status(500).json({ success: false, message: "Failed to share location" })
  }
}

// Stop sharing live location
exports.stopSharingLocation = async (req, res) => {
  try {
    const bookingId = req.params.id
    const booking = await Booking.findById(bookingId)
    
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" })
    }

    // Verify the customer owns this booking
    if (booking.customer.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Access denied" })
    }

    // Stop location sharing
    if (booking.customerLocation) {
      booking.customerLocation.shareLocation = false
    }

    await booking.save()

    res.json({
      success: true,
      message: "Location sharing stopped"
    })
  } catch (error) {
    console.error("Stop sharing location error:", error)
    res.status(500).json({ success: false, message: "Failed to stop location sharing" })
  }
}

module.exports = exports
