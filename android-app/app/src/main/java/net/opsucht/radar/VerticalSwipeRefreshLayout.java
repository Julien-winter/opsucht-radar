package net.opsucht.radar;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/** Pull-to-refresh container that never steals horizontal WebView gestures. */
public final class VerticalSwipeRefreshLayout extends SwipeRefreshLayout {
    private float downX;
    private float downY;
    private boolean horizontalGesture;

    public VerticalSwipeRefreshLayout(@NonNull Context context) { super(context); }
    public VerticalSwipeRefreshLayout(@NonNull Context context, @Nullable AttributeSet attrs) { super(context, attrs); }

    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = event.getX();
                downY = event.getY();
                horizontalGesture = false;
                break;
            case MotionEvent.ACTION_MOVE:
                float dx = event.getX() - downX;
                float dy = event.getY() - downY;
                if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8f) {
                    horizontalGesture = true;
                }
                if (horizontalGesture) return false;
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                horizontalGesture = false;
                break;
            default:
                break;
        }
        return super.onInterceptTouchEvent(event);
    }
}
