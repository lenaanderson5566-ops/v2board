<?php
namespace App\Http\Controllers\V10;
class UserNoticeController extends ResourceController
{
    public function getMeNotifications(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeNotifications');
        $result = app(\App\Services\Actions\User\NoticeActions::class)->inbox($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeNotifications');
    }
    public function postMeNotificationsReadReceipts(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeNotificationsReadReceipts');
        $result = app(\App\Services\Actions\User\NoticeActions::class)->read($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeNotificationsReadReceipts');
    }
    public function getAnnouncements(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getAnnouncements');
        $result = app(\App\Services\Actions\User\NoticeActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getAnnouncements');
    }
    public function getAnnouncementsNotificationId(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getAnnouncementsNotificationId');
        $result = app(\App\Services\Actions\User\NoticeActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getAnnouncementsNotificationId');
    }
}
