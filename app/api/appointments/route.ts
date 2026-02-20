/**
 * Appointment API - FHIR via Medplum
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  saveAppointmentToMedplum,
  getAppointmentFromMedplum,
  getPatientAppointmentsFromMedplum,
  getAppointmentsFromMedplum,
  updateAppointmentStatus,
} from '@/lib/fhir/appointment-service';
import type { AppointmentStatus } from '@/lib/models';

/**
 * POST - Create a new appointment
 */
export async function POST(request: NextRequest) {
  try {
    const appointmentData = await request.json();

    // Validate required fields
    if (!appointmentData.patientId || !appointmentData.patientName || !appointmentData.clinician || 
        !appointmentData.reason || !appointmentData.scheduledAt) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const appointmentId = await saveAppointmentToMedplum(appointmentData);

    return NextResponse.json({
      success: true,
      appointmentId,
      message: 'Appointment saved to FHIR successfully',
    });
  } catch (error: any) {
    console.error('❌ Failed to save appointment:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to save appointment',
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Get appointments
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const appointmentId = searchParams.get('id');
    const patientId = searchParams.get('patientId');
    const statusParam = searchParams.get('status');
    const statuses = statusParam
      ? (statusParam.split(',').map((status) => status.trim()).filter(Boolean) as AppointmentStatus[])
      : undefined;

    // Get specific appointment
    if (appointmentId) {
      const appointment = await getAppointmentFromMedplum(appointmentId);
      if (!appointment) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, appointment });
    }

    // Get patient appointments
    if (patientId) {
      const appointments = await getPatientAppointmentsFromMedplum(patientId);
      return NextResponse.json({
        success: true,
        count: appointments.length,
        appointments,
      });
    }

    const appointments = await getAppointmentsFromMedplum(statuses);
    return NextResponse.json({
      success: true,
      count: appointments.length,
      appointments,
    });
  } catch (error: any) {
    console.error('❌ Failed to get appointments:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get appointments',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update appointment status
 */
export async function PATCH(request: NextRequest) {
  try {
    const { appointmentId, status, checkInTime, completedAt, cancelledAt } = await request.json();

    if (!appointmentId || !status) {
      return NextResponse.json({ error: 'Missing appointmentId or status' }, { status: 400 });
    }

    await updateAppointmentStatus(appointmentId, status, {
      checkInTime,
      completedAt,
      cancelledAt,
    });

    return NextResponse.json({
      success: true,
      message: 'Appointment updated successfully',
    });
  } catch (error: any) {
    console.error('❌ Failed to update appointment:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update appointment',
      },
      { status: 500 }
    );
  }
}




